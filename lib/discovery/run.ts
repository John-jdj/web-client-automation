import "server-only";
import { createClient } from "@/lib/supabase/server";
import { searchBusinesses } from "@/lib/google/places";
import { mapGooglePlaceToBusiness, normalizeBusinessName } from "@/lib/google/normalize";
import { DiscoveryError } from "@/lib/google/errors";
import { upsertBusiness, type Business } from "@/lib/db/businesses";
import { createLead, getLatestLeadForBusiness, shouldCreateLead } from "@/lib/db/leads";
import { isSuppressed } from "@/lib/db/suppression";
import { resolveLeadDecision } from "@/lib/discovery/lead-rules";
import type { DiscoveryRequest } from "@/lib/validation/schemas";
import type { LeadStatus } from "@/lib/supabase/database.types";

export interface DiscoveryBusinessResult {
  id: string;
  businessName: string;
  category: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  hasWebsite: boolean;
  rating: number | null;
  reviewCount: number | null;
  isNewBusiness: boolean;
  leadId: string | null;
  leadStatus: LeadStatus | null;
  leadCreated: boolean;
  suppressed: boolean;
}

export interface DiscoverySummary {
  found: number;
  saved: number;
  duplicates: number;
  withWebsite: number;
  withoutWebsite: number;
  newLeads: number;
}

export interface DiscoveryRunResult {
  summary: DiscoverySummary;
  businesses: DiscoveryBusinessResult[];
  usedMock: boolean;
}

/**
 * Runs one discovery execution end-to-end: search Google Places, normalize
 * + deduplicate into `businesses`, create `leads` only for businesses with
 * no official website (skipping suppressed/DO_NOT_CONTACT businesses), and
 * record the execution in `automation_runs` / `api_usage` / `error_logs`.
 * Per-business failures are collected and logged, and don't abort the run.
 */
export async function runDiscovery(request: DiscoveryRequest): Promise<DiscoveryRunResult> {
  const supabase = await createClient();

  const { data: run, error: runError } = await supabase
    .from("automation_runs")
    .insert({
      status: "RUNNING",
      metadata: {
        location: request.location,
        category: request.category,
        limit: request.limit,
        trigger: "manual_discovery",
      },
    })
    .select("*")
    .single();
  if (runError || !run) throw runError ?? new Error("Failed to create automation run.");
  const runId = run.id;

  let errorCount = 0;
  let firstErrorMessage: string | null = null;
  const results: DiscoveryBusinessResult[] = [];
  let saved = 0;
  let duplicates = 0;
  let withWebsite = 0;
  let withoutWebsite = 0;
  let newLeads = 0;
  let usedMock = false;
  let requestCount = 0;

  async function logError(message: string, businessId?: string) {
    errorCount += 1;
    if (!firstErrorMessage) firstErrorMessage = message;
    await supabase.from("error_logs").insert({
      service: "discovery",
      message,
      run_id: runId,
      metadata: businessId ? { business_id: businessId } : null,
    });
  }

  try {
    const searchResult = await searchBusinesses({
      location: request.location,
      category: request.category,
      limit: request.limit,
    });
    usedMock = searchResult.usedMock;
    requestCount = searchResult.requestCount;

    for (const place of searchResult.places) {
      try {
        const normalized = mapGooglePlaceToBusiness(place);
        if (!normalized.businessName) {
          await logError(`Skipped a place with no name (place_id=${normalized.googlePlaceId}).`);
          continue;
        }

        const checkedAt = new Date().toISOString();
        const { business, isNew } = await upsertBusiness({
          google_place_id: normalized.googlePlaceId,
          business_name: normalized.businessName,
          normalized_business_name: normalizeBusinessName(normalized.businessName),
          category: normalized.category,
          phone: normalized.phone,
          website_url: normalized.websiteUrl,
          has_website: normalized.hasWebsite,
          website_checked_at: checkedAt,
          website_check_status: "CHECKED",
          address: normalized.address,
          city: normalized.city,
          state: normalized.state,
          country: normalized.country,
          postal_code: normalized.postalCode,
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          rating: normalized.rating,
          review_count: normalized.reviewCount,
          google_maps_url: normalized.googleMapsUrl,
          opening_hours: normalized.openingHours,
          source: usedMock ? "google_places_demo" : "google_places",
          raw_data: normalized.rawData,
        });

        if (isNew) saved += 1;
        else duplicates += 1;
        if (business.has_website) withWebsite += 1;
        else withoutWebsite += 1;

        const leadResult = await ensureLeadForBusiness(business);
        if (leadResult.leadCreated) newLeads += 1;

        results.push({
          id: business.id,
          businessName: business.business_name,
          category: business.category,
          city: business.city,
          address: business.address,
          phone: business.phone,
          websiteUrl: business.website_url,
          hasWebsite: business.has_website,
          rating: business.rating,
          reviewCount: business.review_count,
          isNewBusiness: isNew,
          leadId: leadResult.leadId,
          leadStatus: leadResult.leadStatus,
          leadCreated: leadResult.leadCreated,
          suppressed: leadResult.suppressed,
        });
      } catch (err) {
        await logError(
          err instanceof Error ? err.message : "Unknown error processing a business."
        );
      }
    }

    await supabase.from("api_usage").insert({
      provider: "google_places",
      operation: "text_search",
      quantity: requestCount,
      metadata: {
        location: request.location,
        category: request.category,
        limit: request.limit,
        usedMock,
      },
    });

    await supabase
      .from("automation_runs")
      .update({
        status: errorCount > 0 ? "PARTIAL" : "COMPLETED",
        completed_at: new Date().toISOString(),
        businesses_found: searchResult.places.length,
        duplicates_removed: duplicates,
        no_website_found: withoutWebsite,
        qualified_leads: newLeads,
        error_count: errorCount,
        error_message: firstErrorMessage,
      })
      .eq("id", runId);

    return {
      summary: {
        found: searchResult.places.length,
        saved,
        duplicates,
        withWebsite,
        withoutWebsite,
        newLeads,
      },
      businesses: results,
      usedMock,
    };
  } catch (err) {
    const message =
      err instanceof DiscoveryError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Discovery run failed.";

    await supabase
      .from("automation_runs")
      .update({
        status: "FAILED",
        completed_at: new Date().toISOString(),
        error_count: errorCount + 1,
        error_message: message,
      })
      .eq("id", runId);

    throw err;
  }
}

interface LeadResolution {
  leadId: string | null;
  leadStatus: LeadStatus | null;
  leadCreated: boolean;
  suppressed: boolean;
}

/**
 * Decides whether to create a lead for a discovered business, honoring:
 *  - the no-website / no-active-lead rule (shouldCreateLead),
 *  - DO_NOT_CONTACT (handled inside shouldCreateLead), and
 *  - the suppression list — a suppressed business is never given a new
 *    outreach-eligible lead, even though it still appears in results.
 */
async function ensureLeadForBusiness(business: Business): Promise<LeadResolution> {
  const existing = await getLatestLeadForBusiness(business.id);
  const existingStatus = existing?.status ?? null;

  if (!shouldCreateLead(business.has_website, existingStatus)) {
    return {
      leadId: existing?.id ?? null,
      leadStatus: existingStatus,
      leadCreated: false,
      suppressed: false,
    };
  }

  const suppressed = await isSuppressed({ phone: business.phone, email: business.email });
  const create = resolveLeadDecision({
    hasWebsite: business.has_website,
    existingLeadStatus: existingStatus,
    suppressed,
  });
  if (!create) {
    return { leadId: null, leadStatus: existingStatus, leadCreated: false, suppressed };
  }

  const lead = await createLead({
    business_id: business.id,
    status: "NEW",
    priority: "MEDIUM",
    qualification_status: "PENDING",
    lead_score: 0,
    source: "google_places",
  });

  return { leadId: lead.id, leadStatus: lead.status, leadCreated: true, suppressed: false };
}
