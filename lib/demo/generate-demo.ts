import "server-only";
import { getLead, updateLead } from "@/lib/db/leads";
import { getBusiness, type Business } from "@/lib/db/businesses";
import { getLatestLeadAnalysis } from "@/lib/db/lead-analysis";
import { createDemo, getLatestDemoForLead, type Demo } from "@/lib/db/demos";
import { selectTemplate, type DemoTemplate } from "@/lib/templates/registry";
import { generateDemoContent } from "@/lib/demo/generate-demo-content";
import { buildDemoSlug } from "@/lib/demo/slug";
import { DemoContentSchema } from "@/lib/validation/schemas";
import { AnalysisError } from "@/lib/ai/errors";
import { getRequestContext, type AutomationContext } from "@/lib/automation/context";
import type { DemoContentInput } from "@/prompts/demo-generation";
import type { AppSupabaseClient } from "@/lib/supabase/types";

const MAX_ATTEMPTS = 2;

export type GenerateDemoIneligibleCode =
  | "LEAD_NOT_FOUND"
  | "BUSINESS_NOT_FOUND"
  | "NOT_QUALIFIED"
  | "ANALYSIS_MISSING";

export class GenerateDemoIneligibleError extends Error {
  code: GenerateDemoIneligibleCode;
  constructor(code: GenerateDemoIneligibleCode, message: string) {
    super(message);
    this.name = "GenerateDemoIneligibleError";
    this.code = code;
  }
}

export interface GenerateDemoResult {
  alreadyGenerated: boolean;
  demoId: string;
  leadId: string;
  slug: string;
  previewPath: string;
  templateSlug: string;
  templateName: string;
  usedMock: boolean;
  status: Demo["status"];
}

/**
 * Runs the full Step 8 pipeline for one qualified lead:
 *
 *   Qualified Lead -> Lead Analysis -> Select Business Template ->
 *   Generate Personalized Demo Content -> Create Demo Website ->
 *   Validate Demo -> Save Demo in Supabase -> Preview Demo
 *
 * Mirrors lib/ai/analyze-lead.ts's shape: eligibility checked up front
 * without mutating anything, idempotent unless `regenerate`, bounded
 * retry on transient content-generation failures, and a demo row is only
 * ever written once fully validated (never a partial/invalid one).
 * "Preview Demo" is served by app/demo/[id]/page.tsx, which just reads
 * back the saved `generated_content` — no deployment involved.
 *
 * `context` defaults to the normal RLS-scoped request context (every
 * existing route/UI caller is unaffected). Passing `getServiceContext()`
 * is for trusted server-side automation execution only — see
 * lib/automation/context.ts.
 */
export async function generateDemo(
  leadId: string,
  options: { regenerate?: boolean } = {},
  context?: AutomationContext
): Promise<GenerateDemoResult> {
  const { supabase } = context ?? (await getRequestContext());

  const lead = await getLead(leadId, supabase);
  if (!lead) {
    throw new GenerateDemoIneligibleError("LEAD_NOT_FOUND", "Lead not found.");
  }
  const business = await getBusiness(lead.business_id, supabase);
  if (!business) {
    throw new GenerateDemoIneligibleError("BUSINESS_NOT_FOUND", "Business not found for this lead.");
  }
  if (lead.qualification_status !== "QUALIFIED") {
    throw new GenerateDemoIneligibleError(
      "NOT_QUALIFIED",
      "This lead has not been qualified — run analysis first."
    );
  }
  const analysis = await getLatestLeadAnalysis(leadId, supabase);
  if (!analysis) {
    throw new GenerateDemoIneligibleError(
      "ANALYSIS_MISSING",
      "This lead has no AI analysis yet — run analysis before generating a demo."
    );
  }

  if (!options.regenerate) {
    const existing = await getLatestDemoForLead(leadId, supabase);
    if (existing && existing.status === "GENERATED") {
      const content = existing.generated_content as { templateSlug?: string; templateName?: string } | null;
      return {
        alreadyGenerated: true,
        demoId: existing.id,
        leadId,
        slug: existing.slug,
        previewPath: `/demo/${existing.id}`,
        templateSlug: content?.templateSlug ?? "general-business",
        templateName: content?.templateName ?? "General Business",
        usedMock: false,
        status: existing.status,
      };
    }
  }

  const template = selectTemplate(business.category);
  const previousStatus = lead.status;
  await updateLead(leadId, { status: "DEMO_PENDING" }, supabase);

  const contentInput: DemoContentInput = {
    businessName: business.business_name,
    category: business.category,
    city: business.city,
    state: business.state,
    businessSummary: analysis.business_summary ?? "",
    targetCustomers: analysis.target_customer ? analysis.target_customer.split(", ") : [],
    likelyServices: (analysis.services as string[] | null) ?? [],
    painPoints: (analysis.pain_points as string[] | null) ?? [],
    personalizationPoints: (analysis.personalization_points as string[] | null) ?? [],
    designStyle: analysis.design_style ?? "Clean and modern",
    templateName: template.name,
    servicesLabel: template.servicesLabel,
    ctaKicker: template.ctaKicker,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await runGenerationOnce(leadId, business, template, contentInput, supabase);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof AnalysisError ? err.retryable || err.code === "INVALID_RESPONSE" : false;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
    }
  }

  await updateLead(leadId, { status: previousStatus }, supabase);
  await logDemoError(leadId, lastError, supabase);
  const message =
    lastError instanceof AnalysisError
      ? lastError.message
      : lastError instanceof Error
        ? lastError.message
        : "Demo generation failed.";
  throw new AnalysisError("UNKNOWN", message, false);
}

async function runGenerationOnce(
  leadId: string,
  business: Business,
  template: DemoTemplate,
  contentInput: DemoContentInput,
  supabase: AppSupabaseClient
): Promise<GenerateDemoResult> {
  const { data: copy, usedMock, model, promptVersion, usage } = await generateDemoContent(contentInput);

  const merged = {
    ...copy,
    templateSlug: template.slug,
    templateName: template.name,
    designStyle: contentInput.designStyle,
    contactInfo: {
      phone: business.phone,
      address: business.address,
      city: business.city,
    },
  };

  const validated = DemoContentSchema.safeParse(merged);
  if (!validated.success) {
    throw new AnalysisError(
      "INVALID_RESPONSE",
      `Generated demo content failed validation: ${validated.error.message}`,
      false
    );
  }

  const slug = buildDemoSlug(business.business_name, leadId);

  const demo = await createDemo(
    {
      lead_id: leadId,
      template_id: null,
      name: `${business.business_name} — Demo Website`,
      slug,
      status: "GENERATED",
      generated_content: validated.data,
    },
    supabase
  );

  await updateLead(leadId, { status: "DEMO_CREATED" }, supabase);

  if (!usedMock) {
    await logApiUsage(usage, supabase);
  }
  void model;
  void promptVersion;

  return {
    alreadyGenerated: false,
    demoId: demo.id,
    leadId,
    slug: demo.slug,
    previewPath: `/demo/${demo.id}`,
    templateSlug: template.slug,
    templateName: template.name,
    usedMock,
    status: demo.status,
  };
}

async function logApiUsage(
  usage: { inputTokens: number; outputTokens: number } | null,
  supabase: AppSupabaseClient
) {
  await supabase.from("api_usage").insert({
    provider: "anthropic",
    operation: "demo_content_generation",
    quantity: 1,
    metadata: usage
      ? { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens }
      : null,
  });
}

async function logDemoError(leadId: string, err: unknown, supabase: AppSupabaseClient) {
  const message =
    err instanceof AnalysisError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Unknown demo generation error.";
  await supabase.from("error_logs").insert({
    service: "demo_generation",
    message,
    lead_id: leadId,
  });
}
