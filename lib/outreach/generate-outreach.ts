import "server-only";
import { getLead } from "@/lib/db/leads";
import { getBusiness } from "@/lib/db/businesses";
import { isSuppressed } from "@/lib/db/suppression";
import { getLatestLeadAnalysis } from "@/lib/db/lead-analysis";
import { getLatestDemoForLead } from "@/lib/db/demos";
import { getLatestDeploymentForDemo } from "@/lib/db/demo-deployments";
import {
  createOutreachMessage,
  getLatestOutreachForLead,
  hasActiveOrSentOutreach,
  type OutreachMessage,
} from "@/lib/db/outreach";
import { generateOutreachContent } from "@/lib/outreach/generate-outreach-content";
import { OutreachCopySchema } from "@/lib/validation/schemas";
import { AnalysisError } from "@/lib/ai/errors";
import { getRequestContext, type AutomationContext } from "@/lib/automation/context";
import type { OutreachContentInput } from "@/prompts/outreach-generation";
import type { AppSupabaseClient } from "@/lib/supabase/types";

export type GenerateOutreachIneligibleCode =
  | "LEAD_NOT_FOUND"
  | "BUSINESS_NOT_FOUND"
  | "NOT_QUALIFIED"
  | "ANALYSIS_MISSING"
  | "MISSING_EMAIL"
  | "SUPPRESSED"
  | "DO_NOT_CONTACT"
  | "DUPLICATE_ACTIVE_OUTREACH";

export class GenerateOutreachIneligibleError extends Error {
  code: GenerateOutreachIneligibleCode;
  constructor(code: GenerateOutreachIneligibleCode, message: string) {
    super(message);
    this.name = "GenerateOutreachIneligibleError";
    this.code = code;
  }
}

export interface GenerateOutreachResult {
  alreadyGenerated: boolean;
  messageId: string;
  leadId: string;
  status: OutreachMessage["status"];
  recipientEmail: string;
  subject: string;
  body: string;
  cta: string;
  personalizationPoints: string[];
  demoUrl: string | null;
  usedMock: boolean;
}

/**
 * Confirms a lead is eligible for outreach generation without calling
 * Claude or mutating anything — mirrors lib/ai/analyze-lead.ts's
 * assertLeadEligible / lib/demo/generate-demo.ts's inline checks. Every
 * check here is a hard safety blocker (section 2 of the Step 10 spec);
 * none of them can be bypassed by configuration.
 */
async function assertOutreachEligible(
  lead: NonNullable<Awaited<ReturnType<typeof getLead>>>,
  business: NonNullable<Awaited<ReturnType<typeof getBusiness>>>,
  supabase: AppSupabaseClient
): Promise<void> {
  if (lead.status === "DO_NOT_CONTACT") {
    throw new GenerateOutreachIneligibleError("DO_NOT_CONTACT", "This lead is marked DO_NOT_CONTACT.");
  }
  if (lead.qualification_status !== "QUALIFIED") {
    throw new GenerateOutreachIneligibleError(
      "NOT_QUALIFIED",
      "This lead has not been qualified — run analysis first."
    );
  }
  if (!business.email) {
    throw new GenerateOutreachIneligibleError(
      "MISSING_EMAIL",
      "This business has no recipient email on file."
    );
  }
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business.email);
  if (!emailLooksValid) {
    throw new GenerateOutreachIneligibleError("MISSING_EMAIL", "This business's email on file is invalid.");
  }
  const suppressed = await isSuppressed({ phone: business.phone, email: business.email }, supabase);
  if (suppressed) {
    throw new GenerateOutreachIneligibleError("SUPPRESSED", "This business is on the suppression list.");
  }
  const active = await hasActiveOrSentOutreach(lead.id, supabase);
  if (active) {
    throw new GenerateOutreachIneligibleError(
      "DUPLICATE_ACTIVE_OUTREACH",
      "This lead already has an active or sent outreach message."
    );
  }
}

/**
 * Step 10's generation stage: eligibility (no fabrication-prone or
 * suppressed/duplicate path ever reaches Claude) → build content input
 * from ONLY verified fields (business record + Step 7's already-validated
 * lead_analysis + Step 9's deployed demo URL, if any) → generate copy
 * (Claude or, in DEMO_MODE, the deterministic mock) → validate → save as
 * a DRAFT. Never sends anything — see lib/outreach/send-outreach.ts, which
 * the automation runner (Step 11) also never calls.
 *
 * `context` defaults to the normal RLS-scoped request context (every
 * existing route/UI caller is unaffected). Passing `getServiceContext()`
 * is for trusted server-side automation execution only — see
 * lib/automation/context.ts.
 */
export async function generateOutreach(
  leadId: string,
  context?: AutomationContext
): Promise<GenerateOutreachResult> {
  const { supabase } = context ?? (await getRequestContext());

  const lead = await getLead(leadId, supabase);
  if (!lead) {
    throw new GenerateOutreachIneligibleError("LEAD_NOT_FOUND", "Lead not found.");
  }
  const business = await getBusiness(lead.business_id, supabase);
  if (!business) {
    throw new GenerateOutreachIneligibleError("BUSINESS_NOT_FOUND", "Business not found for this lead.");
  }

  const existing = await getLatestOutreachForLead(leadId, supabase);
  if (existing && existing.status === "DRAFT") {
    return toResult(existing, true);
  }

  await assertOutreachEligible(lead, business, supabase);

  const analysis = await getLatestLeadAnalysis(leadId, supabase);
  if (!analysis) {
    throw new GenerateOutreachIneligibleError(
      "ANALYSIS_MISSING",
      "This lead has no AI analysis yet — run analysis before generating outreach."
    );
  }

  const demo = await getLatestDemoForLead(leadId, supabase);
  const deployment = demo ? await getLatestDeploymentForDemo(demo.id, supabase) : null;
  const demoUrl = deployment && deployment.status === "READY" ? deployment.deployment_url : null;

  const contentInput: OutreachContentInput = {
    businessName: business.business_name,
    category: business.category,
    city: business.city,
    state: business.state,
    hasWebsite: business.has_website,
    businessSummary: analysis.business_summary ?? "",
    likelyServices: (analysis.services as string[] | null) ?? [],
    painPoints: (analysis.pain_points as string[] | null) ?? [],
    personalizationPoints: (analysis.personalization_points as string[] | null) ?? [],
    demoUrl,
  };

  const { data: copy, usedMock } = await generateOutreachContent(contentInput);

  const validated = OutreachCopySchema.safeParse(copy);
  if (!validated.success) {
    throw new AnalysisError(
      "INVALID_RESPONSE",
      `Generated outreach content failed validation: ${validated.error.message}`,
      false
    );
  }

  const message = await createOutreachMessage(
    {
      lead_id: leadId,
      channel: "email",
      recipient_email: business.email,
      subject: validated.data.subject,
      message_body: validated.data.body,
      status: "DRAFT",
    },
    supabase
  );

  return {
    alreadyGenerated: false,
    messageId: message.id,
    leadId,
    status: message.status,
    recipientEmail: message.recipient_email ?? business.email ?? "",
    subject: message.subject ?? validated.data.subject,
    body: message.message_body ?? validated.data.body,
    cta: validated.data.cta,
    personalizationPoints: validated.data.personalizationPoints,
    demoUrl,
    usedMock,
  };
}

function toResult(message: OutreachMessage, alreadyGenerated: boolean): GenerateOutreachResult {
  return {
    alreadyGenerated,
    messageId: message.id,
    leadId: message.lead_id,
    status: message.status,
    recipientEmail: message.recipient_email ?? "",
    subject: message.subject ?? "",
    body: message.message_body ?? "",
    cta: "",
    personalizationPoints: [],
    demoUrl: null,
    usedMock: false,
  };
}
