import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database, AutomationJobType } from "@/lib/supabase/database.types";

export type AutomationJob = Database["public"]["Tables"]["automation_jobs"]["Row"];
type AutomationJobResult = Database["public"]["Tables"]["automation_jobs"]["Insert"]["result"];
type AutomationJobPayload = Database["public"]["Tables"]["automation_jobs"]["Insert"]["payload"];

/**
 * Jobs due to run now, oldest first. Used by background job workers, which
 * have no user session — reads via the service-role client and therefore
 * bypasses RLS. Do not call this from user-facing routes.
 */
export async function getPendingJobs(limit = 20): Promise<AutomationJob[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("automation_jobs")
    .select("*")
    .eq("status", "PENDING")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data;
}

/** Creates a job in PENDING state. Service-role, same rationale as getPendingJobs. */
export async function createJob(input: {
  jobType: AutomationJobType;
  runId: string;
  leadId?: string | null;
  payload?: AutomationJobPayload;
  maxAttempts?: number;
}): Promise<AutomationJob> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("automation_jobs")
    .insert({
      job_type: input.jobType,
      run_id: input.runId,
      lead_id: input.leadId ?? null,
      payload: input.payload ?? null,
      // Explicit rather than relying on the DB's column defaults —
      // failJob's retry-vs-exhausted math (attempt_count < max_attempts)
      // needs attempt_count to start at a real 0, not `undefined`.
      attempt_count: 0,
      max_attempts: input.maxAttempts ?? 3,
      status: "PENDING",
      scheduled_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Atomically claims a PENDING job by flipping it to RUNNING. The
 * `.eq("status", "PENDING")` on the update itself (not a separate read
 * first) is what makes this concurrency-safe: Postgres only matches and
 * writes the row if it is still PENDING at that instant, so two workers
 * racing to claim the same job can never both succeed — the loser's
 * update matches zero rows and this returns null, rather than throwing.
 */
export async function claimJob(id: string): Promise<AutomationJob | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("automation_jobs")
    .update({ status: "RUNNING", started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "PENDING")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function completeJob(id: string, result?: AutomationJobResult): Promise<AutomationJob> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("automation_jobs")
    .update({ status: "COMPLETED", completed_at: new Date().toISOString(), result: result ?? null })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Records a failed attempt. Bounded retry, never an internal loop: if the
 * attempt count after this failure is still under the job's max_attempts,
 * it goes to RETRY for a later run to pick up again; once attempts are
 * exhausted it's FAILED for good, so a permanently-broken job can never
 * spin forever.
 */
export async function failJob(job: AutomationJob, errorMessage: string): Promise<AutomationJob> {
  const supabase = createServiceClient();
  const nextAttemptCount = job.attempt_count + 1;
  const status = nextAttemptCount < job.max_attempts ? "RETRY" : "FAILED";
  const { data, error } = await supabase
    .from("automation_jobs")
    .update({
      status,
      attempt_count: nextAttemptCount,
      error_message: errorMessage,
      completed_at: status === "FAILED" ? new Date().toISOString() : null,
    })
    .eq("id", job.id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/**
 * True if a non-terminal (PENDING/RUNNING/RETRY) or already-COMPLETED job
 * of this type already exists for this lead. Checked before creating a
 * new job for the same (lead, job type) pair, so re-running the
 * automation doesn't enqueue duplicate work — idempotency at the
 * job-queue level, on top of each reused service function's own
 * idempotency (analyzeLead/generateDemo/deployDemo/generateOutreach all
 * already no-op on an existing result).
 */
export async function hasActiveOrCompletedJob(
  leadId: string,
  jobType: AutomationJobType
): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("automation_jobs")
    .select("id")
    .eq("lead_id", leadId)
    .eq("job_type", jobType)
    .in("status", ["PENDING", "RUNNING", "RETRY", "COMPLETED"])
    .limit(1);

  if (error) throw error;
  return Boolean(data && data.length > 0);
}
