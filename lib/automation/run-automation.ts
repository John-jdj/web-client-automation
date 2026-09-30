import "server-only";
import { getAutomationSettings, countTodaysAiAnalyses, countTodaysDeployments } from "@/lib/db/automation-settings";
import { getQualifiedLeads } from "@/lib/db/leads";
import { createJob, claimJob, completeJob, failJob, hasActiveOrCompletedJob } from "@/lib/db/jobs";
import { runDiscovery } from "@/lib/discovery/run";
import { analyzeLead, AnalyzeLeadIneligibleError } from "@/lib/ai/analyze-lead";
import { generateDemo, GenerateDemoIneligibleError } from "@/lib/demo/generate-demo";
import { deployDemo, DeployDemoIneligibleError } from "@/lib/demo/deploy-demo";
import { generateOutreach, GenerateOutreachIneligibleError } from "@/lib/outreach/generate-outreach";
import { AnalysisError } from "@/lib/ai/errors";
import { DeploymentError } from "@/lib/vercel/errors";
import { getServiceContext, type AutomationContext } from "@/lib/automation/context";
import type { AutomationSettings } from "@/lib/db/automation-settings";
import type { AutomationRunStatus, AutomationJobType } from "@/lib/supabase/database.types";
import type { AppSupabaseClient } from "@/lib/supabase/types";

/**
 * Step 11.1/11.2 — the central automation runner. This is a *synchronous*
 * orchestrator (one function call runs a full cycle to completion and
 * returns) — there is no cron, no scheduler, and nothing here is invoked
 * automatically by anything else yet. It exists so a future protected
 * endpoint (Step 11.3) has one safe, already-tested entry point to call,
 * rather than that endpoint containing pipeline logic itself.
 *
 * Every step below only ever calls the SAME reused, already-tested
 * service functions the manual UI/routes already use (runDiscovery,
 * analyzeLead, generateDemo, deployDemo, generateOutreach) — nothing here
 * duplicates their eligibility, validation, DEMO_MODE, or safety logic.
 * The one deliberate omission: outreach is only ever DRAFTED
 * (generateOutreach), never sent — sendOutreach is not imported or called
 * anywhere in this file. That is not merely gated by config, it's simply
 * absent from the code path, so no future flip of auto_outreach_enabled
 * can make this runner start sending email on its own.
 *
 * Step 11.4: run-level concurrency protection (at most one RUNNING run at
 * a time) is enforced by a database-level partial unique index, not a
 * check-then-insert race in this file — see reapStaleRuns()/createRunRow()
 * below and supabase/migrations/0002_automation_runs_single_active_run.sql.
 *
 * Step 11.2: this runner now defaults to the service-role context
 * (lib/automation/context.ts's `getServiceContext()`) rather than the
 * cookie-based request context, since its whole purpose is to be callable
 * by a server-side trigger with no user session (a future cron endpoint —
 * not added yet). Every reused function it calls (runDiscovery,
 * analyzeLead, generateDemo, deployDemo, generateOutreach) still defaults
 * to the RLS-scoped context for every OTHER caller (routes, pages) —
 * nothing about their normal, interactive behavior changed. A context can
 * still be passed in explicitly (tests do this) to run against the
 * RLS-scoped client instead.
 */

export type AutomationStepName =
  | "discovery"
  | "lead_analysis"
  | "demo_generation"
  | "demo_deployment"
  | "outreach_preparation"
  | "followup_processing";

const ALL_STEPS: AutomationStepName[] = [
  "discovery",
  "lead_analysis",
  "demo_generation",
  "demo_deployment",
  "outreach_preparation",
  "followup_processing",
];

/** Run-level concurrency lock: a RUNNING run older than this is treated as abandoned/crashed, not a real lock. */
const STALE_RUN_LOCK_MINUTES = 60;

export interface RunAutomationOptions {
  /** Defaults to every step, in pipeline order. */
  steps?: AutomationStepName[];
  /** Per-step candidate batch size, still capped by the relevant automation_settings limit. Default 10. */
  limit?: number;
  /** Required only if the "discovery" step is included. */
  discovery?: { location: string; category: string };
  /**
   * Overrides the default service-role context — e.g. to run against the
   * RLS-scoped client instead (tests only; no production caller needs
   * this today, since nothing yet invokes runAutomation from an
   * authenticated request).
   */
  context?: AutomationContext;
}

export interface AutomationStepResult {
  step: AutomationStepName;
  status: "COMPLETED" | "SKIPPED" | "FAILED";
  reason?: string;
  summary: Record<string, number>;
}

export interface RunAutomationResult {
  runId: string;
  status: AutomationRunStatus;
  steps: AutomationStepResult[];
}

export class AutomationAlreadyRunningError extends Error {
  constructor(public runId: string) {
    super(`Automation is already running (run ${runId}) — refusing to start a second, overlapping run.`);
    this.name = "AutomationAlreadyRunningError";
  }
}

export async function runAutomation(options: RunAutomationOptions = {}): Promise<RunAutomationResult> {
  const context = options.context ?? getServiceContext();
  const { supabase } = context;
  const settings = await getAutomationSettings(supabase);
  const limit = options.limit && options.limit > 0 ? options.limit : 10;
  const requestedSteps = options.steps ?? ALL_STEPS;

  await reapStaleRuns(supabase);
  const run = await createRunRow(supabase, requestedSteps);
  const runId = run.id as string;

  const results: AutomationStepResult[] = [];

  // The master switch. Off by default — with automation_settings.enabled
  // = false (the seeded default), every step is skipped and the run
  // completes immediately having done nothing. This is deliberate: a
  // freshly-deployed instance of this app is inert until an admin turns
  // automation on.
  if (!settings.enabled) {
    for (const step of requestedSteps) {
      results.push({ step, status: "SKIPPED", reason: "automation_settings.enabled is false", summary: {} });
    }
    await finalizeRun(supabase, runId, results);
    return { runId, status: "COMPLETED", steps: results };
  }

  for (const step of requestedSteps) {
    let result: AutomationStepResult;
    try {
      switch (step) {
        case "discovery":
          result = await runDiscoveryStep(runId, settings, limit, options.discovery, context);
          break;
        case "lead_analysis":
          result = await runLeadAnalysisStep(runId, settings, limit, context);
          break;
        case "demo_generation":
          result = await runDemoGenerationStep(runId, settings, limit, context);
          break;
        case "demo_deployment":
          result = await runDemoDeploymentStep(runId, settings, limit, context);
          break;
        case "outreach_preparation":
          result = await runOutreachPreparationStep(runId, settings, limit, context);
          break;
        case "followup_processing":
          result = runFollowupProcessingStep();
          break;
      }
    } catch (err) {
      result = { step, status: "FAILED", reason: safeMessage(err), summary: {} };
      await logRunError(supabase, runId, step, err);
    }
    results.push(result);
  }

  const finalStatus = await finalizeRun(supabase, runId, results);
  return { runId, status: finalStatus, steps: results };
}

/**
 * Step 11.4 — run-level concurrency protection is now database-level, via
 * a partial unique index (supabase/migrations/0002_automation_runs_single_active_run.sql:
 * `unique (status) where status = 'RUNNING'`). At most one RUNNING row can
 * ever exist, enforced atomically by Postgres itself — not by a
 * check-then-insert race in application code. This function only reaps
 * old abandoned runs first (see below); the actual concurrency guarantee
 * lives in createRunRow()'s insert + unique-violation handling.
 *
 * A RUNNING row older than STALE_RUN_LOCK_MINUTES is treated as
 * abandoned/crashed (e.g. the process was killed mid-execution) and is
 * marked FAILED here so it stops occupying the one "active run" slot the
 * unique index allows. This update is itself safe under concurrency: it
 * only flips rows that still match `status = 'RUNNING' AND started_at <
 * staleBefore`, so two callers reaping at once just perform the same
 * idempotent transition (the second matches zero rows and no-ops) — it
 * never creates or removes a RUNNING row, so it can't itself race with
 * the unique index.
 */
async function reapStaleRuns(supabase: AppSupabaseClient): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_RUN_LOCK_MINUTES * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("automation_runs")
    .update({
      status: "FAILED",
      completed_at: new Date().toISOString(),
      error_message: "Automation run abandoned: exceeded the stale-run threshold without completing.",
    })
    .eq("status", "RUNNING")
    .lt("started_at", staleBefore);
  if (error) throw error;
}

/**
 * Creates the new RUNNING row. If another caller's insert won the race
 * (the partial unique index rejects a second concurrent RUNNING row with
 * a 23505 unique_violation), that raw Postgres error is never surfaced —
 * it's converted into the same AutomationAlreadyRunningError callers
 * already handle (e.g. app/api/automation/run/route.ts mapping it to a
 * 409), with a best-effort lookup of the run that actually won, purely
 * for a friendlier error message.
 */
async function createRunRow(
  supabase: AppSupabaseClient,
  requestedSteps: AutomationStepName[]
): Promise<{ id: string }> {
  const { data: run, error: runError } = await supabase
    .from("automation_runs")
    .insert({ status: "RUNNING", metadata: { trigger: "manual", steps: requestedSteps } })
    .select("*")
    .single();

  if (runError) {
    if (isUniqueViolation(runError)) {
      const existing = await findActiveRun(supabase);
      throw new AutomationAlreadyRunningError(existing?.id ?? "unknown");
    }
    throw runError;
  }
  if (!run) throw new Error("Failed to create automation run.");
  return run as { id: string };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function findActiveRun(supabase: AppSupabaseClient): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("automation_runs")
    .select("id")
    .eq("status", "RUNNING")
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

async function finalizeRun(
  supabase: AppSupabaseClient,
  runId: string,
  results: AutomationStepResult[]
): Promise<AutomationRunStatus> {
  const anyFailed = results.some((r) => r.status === "FAILED");
  const anyCompleted = results.some((r) => r.status === "COMPLETED");
  const status: AutomationRunStatus = anyFailed ? (anyCompleted ? "PARTIAL" : "FAILED") : "COMPLETED";

  const totals = {
    businesses_found: sumField(results, "businessesFound"),
    duplicates_removed: sumField(results, "duplicatesRemoved"),
    no_website_found: sumField(results, "noWebsiteFound"),
    qualified_leads: sumField(results, "qualifiedLeads"),
    demos_created: sumField(results, "demosCreated"),
    deployments_successful: sumField(results, "deploymentsSuccessful"),
    messages_generated: sumField(results, "messagesGenerated"),
    error_count: results.filter((r) => r.status === "FAILED").length,
  };

  await supabase
    .from("automation_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      ...totals,
      // Plain step results (no AI/CRM content — only step names, statuses,
      // reasons, and numeric summaries), JSON-round-tripped only to
      // satisfy the Json column type.
      metadata: JSON.parse(JSON.stringify({ steps: results })),
      error_message: anyFailed ? results.find((r) => r.status === "FAILED")?.reason ?? null : null,
    })
    .eq("id", runId);

  return status;
}

function sumField(results: AutomationStepResult[], field: string): number {
  return results.reduce((total, r) => total + (r.summary[field] ?? 0), 0);
}

async function logRunError(
  supabase: AppSupabaseClient,
  runId: string,
  step: AutomationStepName,
  err: unknown
): Promise<void> {
  await supabase.from("error_logs").insert({
    service: `automation_${step}`,
    message: safeMessage(err),
    run_id: runId,
  });
}

/** Never the raw error object — only a message string, and only from error classes already designed to be safe-to-display (never a raw provider/DB error). */
function safeMessage(err: unknown): string {
  if (
    err instanceof AnalyzeLeadIneligibleError ||
    err instanceof GenerateDemoIneligibleError ||
    err instanceof DeployDemoIneligibleError ||
    err instanceof GenerateOutreachIneligibleError ||
    err instanceof AnalysisError ||
    err instanceof DeploymentError ||
    err instanceof AutomationAlreadyRunningError
  ) {
    return err.message;
  }
  if (err instanceof Error) return "An unexpected error occurred.";
  return "An unexpected error occurred.";
}

// ---------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------

async function runDiscoveryStep(
  runId: string,
  settings: AutomationSettings,
  limit: number,
  discovery: RunAutomationOptions["discovery"],
  context: AutomationContext
): Promise<AutomationStepResult> {
  if (!settings.discovery_enabled) {
    return { step: "discovery", status: "SKIPPED", reason: "discovery_enabled is false", summary: {} };
  }
  if (!discovery) {
    return {
      step: "discovery",
      status: "SKIPPED",
      reason: "no location/category supplied for this run",
      summary: {},
    };
  }

  const effectiveLimit = Math.min(limit, settings.daily_discovery_limit);
  const result = await runDiscovery(
    {
      location: discovery.location,
      category: discovery.category,
      limit: effectiveLimit,
    },
    context
  );
  void runId; // discovery records its own automation_runs row internally (see the file-level comment for how the two compose)

  return {
    step: "discovery",
    status: "COMPLETED",
    summary: {
      businessesFound: result.summary.found,
      duplicatesRemoved: result.summary.duplicates,
      noWebsiteFound: result.summary.withoutWebsite,
      qualifiedLeads: result.summary.newLeads,
    },
  };
}

async function runLeadAnalysisStep(
  runId: string,
  settings: AutomationSettings,
  limit: number,
  context: AutomationContext
): Promise<AutomationStepResult> {
  if (!settings.ai_analysis_enabled) {
    return { step: "lead_analysis", status: "SKIPPED", reason: "ai_analysis_enabled is false", summary: {} };
  }

  const { supabase } = context;
  const usedToday = await countTodaysAiAnalyses(supabase);
  const remaining = Math.max(0, settings.daily_ai_limit - usedToday);
  const effectiveLimit = Math.min(limit, remaining);
  if (effectiveLimit <= 0) {
    return { step: "lead_analysis", status: "SKIPPED", reason: "daily_ai_limit reached", summary: {} };
  }

  const { data: candidates, error } = await supabase
    .from("leads")
    .select("id, status, businesses!inner(has_website)")
    .in("status", ["NEW", "ANALYZING"])
    .eq("businesses.has_website", false)
    .order("created_at", { ascending: true })
    .limit(effectiveLimit * 2);
  if (error) throw error;

  let qualified = 0;
  let processed = 0;
  for (const candidate of candidates ?? []) {
    if (processed >= effectiveLimit) break;
    const leadId = candidate.id as string;
    const ran = await runJobForLead(runId, leadId, "ANALYZE_LEAD", async () => {
      const outcome = await analyzeLead(leadId, {}, context);
      if (!outcome.alreadyAnalyzed && outcome.qualificationStatus === "QUALIFIED") qualified += 1;
      return outcome;
    });
    if (ran) processed += 1;
  }

  return {
    step: "lead_analysis",
    status: "COMPLETED",
    summary: { qualifiedLeads: qualified },
  };
}

async function runDemoGenerationStep(
  runId: string,
  settings: AutomationSettings,
  limit: number,
  context: AutomationContext
): Promise<AutomationStepResult> {
  if (!settings.demo_generation_enabled) {
    return { step: "demo_generation", status: "SKIPPED", reason: "demo_generation_enabled is false", summary: {} };
  }

  // No dedicated daily-usage counter exists yet for demo generation (see
  // the limitations note in the final report) — settings.daily_demo_limit
  // is applied as a per-run cap only, not a rolling daily total.
  const effectiveLimit = Math.min(limit, settings.daily_demo_limit);
  if (effectiveLimit <= 0) {
    return { step: "demo_generation", status: "SKIPPED", reason: "daily_demo_limit is 0", summary: {} };
  }

  const qualifiedLeads = await getQualifiedLeads(effectiveLimit * 2, context.supabase);
  const candidates = qualifiedLeads.filter((lead) => lead.status === "QUALIFIED");

  let created = 0;
  let processed = 0;
  for (const lead of candidates) {
    if (processed >= effectiveLimit) break;
    const ran = await runJobForLead(runId, lead.id, "GENERATE_DEMO", async () => {
      const outcome = await generateDemo(lead.id, {}, context);
      if (!outcome.alreadyGenerated) created += 1;
      return outcome;
    });
    if (ran) processed += 1;
  }

  return { step: "demo_generation", status: "COMPLETED", summary: { demosCreated: created } };
}

async function runDemoDeploymentStep(
  runId: string,
  settings: AutomationSettings,
  limit: number,
  context: AutomationContext
): Promise<AutomationStepResult> {
  if (!settings.auto_deployment_enabled) {
    return { step: "demo_deployment", status: "SKIPPED", reason: "auto_deployment_enabled is false", summary: {} };
  }

  const { supabase } = context;
  const usedToday = await countTodaysDeployments(supabase);
  const remaining = Math.max(0, settings.daily_deployment_limit - usedToday);
  const effectiveLimit = Math.min(limit, remaining);
  if (effectiveLimit <= 0) {
    return { step: "demo_deployment", status: "SKIPPED", reason: "daily_deployment_limit reached", summary: {} };
  }

  const { data: candidates, error } = await supabase
    .from("demos")
    .select("id, lead_id, status")
    .eq("status", "GENERATED")
    .order("created_at", { ascending: true })
    .limit(effectiveLimit * 2);
  if (error) throw error;

  let deployed = 0;
  let processed = 0;
  for (const candidate of candidates ?? []) {
    if (processed >= effectiveLimit) break;
    const demoId = candidate.id as string;
    const leadId = candidate.lead_id as string | null;
    const ran = await runJobForLead(runId, leadId, "DEPLOY_DEMO", async () => {
      const outcome = await deployDemo(demoId, context);
      if (!outcome.alreadyDeployed && outcome.status === "READY") deployed += 1;
      return outcome;
    });
    if (ran) processed += 1;
  }

  return { step: "demo_deployment", status: "COMPLETED", summary: { deploymentsSuccessful: deployed } };
}

/**
 * Outreach *preparation only* — creates DRAFT messages via
 * generateOutreach(). sendOutreach is never imported or called from this
 * file, so this step cannot send an email regardless of
 * auto_outreach_enabled/require_outreach_approval; those flags govern the
 * separate, manual /api/outreach/[id]/send path, not this one.
 */
async function runOutreachPreparationStep(
  runId: string,
  settings: AutomationSettings,
  limit: number,
  context: AutomationContext
): Promise<AutomationStepResult> {
  void settings; // no dedicated "preparation enabled" flag exists — gated only by the top-level automation_settings.enabled check in runAutomation()
  const qualifiedLeads = await getQualifiedLeads(limit * 2, context.supabase);

  let prepared = 0;
  let processed = 0;
  for (const lead of qualifiedLeads) {
    if (processed >= limit) break;
    const ran = await runJobForLead(runId, lead.id, "GENERATE_OUTREACH", async () => {
      const outcome = await generateOutreach(lead.id, context);
      if (!outcome.alreadyGenerated) prepared += 1;
      return outcome;
    });
    if (ran) processed += 1;
  }

  return { step: "outreach_preparation", status: "COMPLETED", summary: { messagesGenerated: prepared } };
}

/**
 * Placeholder — no follow-up generation/sending logic exists anywhere in
 * this codebase yet (the `followups` table has no application code
 * behind it), and building that is out of scope for this foundation.
 * Always a safe no-op so the step is present and "modular" per the task,
 * without inventing new business logic.
 */
function runFollowupProcessingStep(): AutomationStepResult {
  return {
    step: "followup_processing",
    status: "SKIPPED",
    reason: "follow-up generation is not implemented yet",
    summary: {},
  };
}

/**
 * Wraps one unit of work in an automation_jobs row: skip if a job for
 * this (lead, type) already exists (idempotency across runs), otherwise
 * create + atomically claim it, run `fn`, and record COMPLETED/failJob
 * (bounded retry, never a loop) accordingly. Returns false when skipped
 * (already handled or lost the claim race) so callers don't count it
 * against their batch limit. automation_jobs access (lib/db/jobs.ts) is
 * always service-role, regardless of which context this runner itself
 * was given — it was already that way before Step 11.2 (background job
 * workers have no session by definition), so it's unaffected here.
 */
async function runJobForLead(
  runId: string,
  leadId: string | null,
  jobType: AutomationJobType,
  fn: () => Promise<unknown>
): Promise<boolean> {
  if (!leadId) return false;
  if (await hasActiveOrCompletedJob(leadId, jobType)) return false;

  const job = await createJob({ jobType, runId, leadId });
  const claimed = await claimJob(job.id);
  if (!claimed) return false; // lost the claim race to another concurrent runner

  try {
    const result = await fn();
    await completeJob(claimed.id, toJsonSummary(result));
    return true;
  } catch (err) {
    await failJob(claimed, safeMessage(err));
    return true; // still "processed" for batch-limit purposes — it was attempted, not skipped
  }
}

/** Keeps only safe-to-store scalar fields from a step outcome — never the raw object (which may carry AI/CRM content). */
function toJsonSummary(outcome: unknown): Record<string, boolean | number | string> | null {
  if (!outcome || typeof outcome !== "object") return null;
  const summary: Record<string, boolean | number | string> = {};
  for (const [key, value] of Object.entries(outcome as Record<string, unknown>)) {
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      summary[key] = value;
    }
  }
  return summary;
}
