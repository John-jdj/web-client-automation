import "server-only";
import { getLead, updateLead, type Lead } from "@/lib/db/leads";
import { getBusiness, type Business } from "@/lib/db/businesses";
import { isSuppressed } from "@/lib/db/suppression";
import { getLatestLeadAnalysis, createLeadAnalysis } from "@/lib/db/lead-analysis";
import { createLeadScore, getLatestLeadScore } from "@/lib/db/lead-scores";
import { analyzeBusiness } from "@/lib/ai/anthropic";
import { AnalysisError } from "@/lib/ai/errors";
import { calculateLeadScore, mapScoreToPriority } from "@/lib/scoring/lead-score";
import { getRequestContext, type AutomationContext } from "@/lib/automation/context";
import type { LeadStatus } from "@/lib/supabase/database.types";
import type { AppSupabaseClient } from "@/lib/supabase/types";

const MAX_ATTEMPTS = 2;

/**
 * Score at/above which an analyzed lead is considered qualified (roughly
 * mapScoreToPriority's MEDIUM+, but intentionally one point above the 40
 * that "no official website" alone always contributes). Every lead that
 * reaches scoring is, by eligibility (assertLeadEligible), one without a
 * website — so calculateLeadScore's +40 baseline is a guaranteed floor,
 * not a signal. Setting this threshold to exactly 40 would make every
 * analyzed lead auto-qualify regardless of any other signal, leaving
 * DISQUALIFIED unreachable; 41 requires at least one real corroborating
 * signal (rating, reviews, phone, email, category, or AI website-need).
 */
const QUALIFICATION_SCORE_THRESHOLD = 41;

export type AnalyzeLeadIneligibleCode =
  | "LEAD_NOT_FOUND"
  | "BUSINESS_NOT_FOUND"
  | "HAS_WEBSITE"
  | "DO_NOT_CONTACT"
  | "SUPPRESSED";

export class AnalyzeLeadIneligibleError extends Error {
  code: AnalyzeLeadIneligibleCode;
  constructor(code: AnalyzeLeadIneligibleCode, message: string) {
    super(message);
    this.name = "AnalyzeLeadIneligibleError";
    this.code = code;
  }
}

export interface AnalyzeLeadResult {
  alreadyAnalyzed: boolean;
  leadId: string;
  status: LeadStatus;
  qualificationStatus: string;
  leadScore: number;
  priority: string;
  analysisId: string;
  scoreId: string;
}

/**
 * Confirms a lead is eligible for AI analysis without calling Claude or
 * mutating anything. Used by both the single-lead route (to fail fast with
 * a clear reason) and the batch route (to filter the candidate list).
 */
export async function assertLeadEligible(
  lead: Lead,
  business: Business,
  supabase?: AppSupabaseClient
): Promise<void> {
  if (business.has_website) {
    throw new AnalyzeLeadIneligibleError(
      "HAS_WEBSITE",
      "This business already has an official website."
    );
  }
  if (lead.status === "DO_NOT_CONTACT") {
    throw new AnalyzeLeadIneligibleError(
      "DO_NOT_CONTACT",
      "This lead is marked DO_NOT_CONTACT."
    );
  }
  const suppressed = await isSuppressed({ phone: business.phone, email: business.email }, supabase);
  if (suppressed) {
    throw new AnalyzeLeadIneligibleError("SUPPRESSED", "This business is on the suppression list.");
  }
}

/**
 * Runs the full Step 7 pipeline for one lead: eligibility → fetch → Claude
 * analysis (with a bounded retry) → Zod validation → deterministic scoring
 * → save analysis/score → update lead status. Idempotent by default — a
 * lead with an existing analysis is not re-analyzed unless `regenerate`.
 *
 * `context` defaults to the normal RLS-scoped request context (every
 * existing route/UI caller is unaffected). Passing `getServiceContext()`
 * is for trusted server-side automation execution only — see
 * lib/automation/context.ts.
 */
export async function analyzeLead(
  leadId: string,
  options: { regenerate?: boolean } = {},
  context?: AutomationContext
): Promise<AnalyzeLeadResult> {
  const { supabase } = context ?? (await getRequestContext());

  const lead = await getLead(leadId, supabase);
  if (!lead) {
    throw new AnalyzeLeadIneligibleError("LEAD_NOT_FOUND", "Lead not found.");
  }
  const business = await getBusiness(lead.business_id, supabase);
  if (!business) {
    throw new AnalyzeLeadIneligibleError("BUSINESS_NOT_FOUND", "Business not found for this lead.");
  }

  await assertLeadEligible(lead, business, supabase);

  if (!options.regenerate) {
    const existing = await getLatestLeadAnalysis(leadId, supabase);
    if (existing) {
      const existingScore = await getLatestLeadScoreOrThrow(leadId, supabase);
      return {
        alreadyAnalyzed: true,
        leadId,
        status: lead.status,
        qualificationStatus: lead.qualification_status,
        leadScore: lead.lead_score,
        priority: lead.priority,
        analysisId: existing.id,
        scoreId: existingScore.id,
      };
    }
  }

  const previousStatus = lead.status;
  await updateLead(leadId, { status: "ANALYZING" }, supabase);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await runAnalysisOnce(leadId, lead, business, supabase);
      return result;
    } catch (err) {
      lastError = err;
      const retryable = err instanceof AnalysisError ? err.retryable || err.code === "INVALID_RESPONSE" : false;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
    }
  }

  // Every attempt failed — restore the lead to a retryable state and log.
  await updateLead(leadId, { status: previousStatus }, supabase);
  await logAnalysisError(leadId, lastError, supabase);
  const message =
    lastError instanceof AnalysisError
      ? lastError.message
      : lastError instanceof Error
        ? lastError.message
        : "Lead analysis failed.";
  throw new AnalysisError("UNKNOWN", message, false);
}

async function getLatestLeadScoreOrThrow(leadId: string, supabase: AppSupabaseClient) {
  const score = await getLatestLeadScore(leadId, supabase);
  if (!score) {
    // Analysis exists but score doesn't (shouldn't happen — they're written
    // together) — treat as not-yet-analyzed so the caller can regenerate.
    throw new AnalysisError(
      "UNKNOWN",
      "Lead has an analysis but no score; call with regenerate=true."
    );
  }
  return score;
}

async function runAnalysisOnce(
  leadId: string,
  lead: Lead,
  business: Business,
  supabase: AppSupabaseClient
): Promise<AnalyzeLeadResult> {
  const analysis = await analyzeBusiness({
    businessName: business.business_name,
    category: business.category,
    subcategory: business.subcategory,
    address: business.address,
    city: business.city,
    state: business.state,
    rating: business.rating,
    reviewCount: business.review_count,
    phoneAvailable: Boolean(business.phone),
    websitePresent: business.has_website,
    services: null,
    openingHours: null,
  });

  const analysisRow = await createLeadAnalysis(
    {
      lead_id: leadId,
      business_summary: analysis.data.businessSummary,
      target_customer: analysis.data.targetCustomers.join(", "),
      services: analysis.data.likelyServices,
      recommended_pages: analysis.data.recommendedPages,
      recommended_features: analysis.data.recommendedFeatures,
      design_style: analysis.data.designStyle,
      recommended_colors: analysis.data.recommendedColors,
      recommended_ctas: analysis.data.recommendedCTAs,
      pain_points: analysis.data.painPoints,
      personalization_points: analysis.data.personalizationPoints,
      ai_provider: analysis.provider,
      ai_model: analysis.model,
      prompt_version: analysis.promptVersion,
      // rawResponse is the SDK's own parsed Message object — never contains
      // the API key or any request header, only Claude's output + usage.
      raw_response: JSON.parse(JSON.stringify(analysis.rawResponse)),
    },
    supabase
  );

  const breakdown = calculateLeadScore({
    hasWebsite: business.has_website,
    rating: business.rating,
    reviewCount: business.review_count,
    phone: business.phone,
    email: business.email,
    category: business.category,
    websiteNeedLevel: analysis.data.websiteNeed.level,
  });

  const scoreRow = await createLeadScore(
    {
      lead_id: leadId,
      score: breakdown.score,
      website_score: breakdown.websiteScore,
      rating_score: breakdown.ratingScore,
      review_score: breakdown.reviewScore,
      phone_score: breakdown.phoneScore,
      email_score: breakdown.emailScore,
      category_score: breakdown.categoryScore,
      activity_score: breakdown.activityScore,
      reasoning: breakdown.reasoning.join("; "),
      scoring_version: breakdown.scoringVersion,
    },
    supabase
  );

  const priority = mapScoreToPriority(breakdown.score);
  const qualifies = breakdown.score >= QUALIFICATION_SCORE_THRESHOLD;
  const newStatus: LeadStatus = qualifies ? "QUALIFIED" : "DISQUALIFIED";
  const qualificationStatus = qualifies ? "QUALIFIED" : "DISQUALIFIED";

  await updateLead(
    leadId,
    {
      status: newStatus,
      qualification_status: qualificationStatus,
      lead_score: breakdown.score,
      priority,
    },
    supabase
  );

  await logApiUsage(analysis.usage, supabase);

  return {
    alreadyAnalyzed: false,
    leadId,
    status: newStatus,
    qualificationStatus,
    leadScore: breakdown.score,
    priority,
    analysisId: analysisRow.id,
    scoreId: scoreRow.id,
  };
}

async function logApiUsage(
  usage: { inputTokens: number; outputTokens: number } | null,
  supabase: AppSupabaseClient
) {
  await supabase.from("api_usage").insert({
    provider: "anthropic",
    operation: "business_analysis",
    quantity: 1,
    metadata: usage
      ? { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens }
      : null,
  });
}

async function logAnalysisError(leadId: string, err: unknown, supabase: AppSupabaseClient) {
  const message =
    err instanceof AnalysisError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Unknown lead analysis error.";
  await supabase.from("error_logs").insert({
    service: "lead_analysis",
    message,
    lead_id: leadId,
  });
}
