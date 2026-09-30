import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));

const { createServiceClient } = await import("@/lib/supabase/service");
const { createJob, claimJob, completeJob, failJob, hasActiveOrCompletedJob, getPendingJobs } = await import(
  "@/lib/db/jobs"
);

let fake: FakeSupabase;

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createServiceClient).mockReturnValue(fake as never);
});

describe("createJob / claimJob (concurrent job protection)", () => {
  it("claims a PENDING job, flipping it to RUNNING", async () => {
    const job = await createJob({ jobType: "ANALYZE_LEAD", runId: randomUUID(), leadId: randomUUID() });
    expect(job.status).toBe("PENDING");

    const claimed = await claimJob(job.id);
    expect(claimed?.status).toBe("RUNNING");
    expect(claimed?.started_at).toBeTruthy();
  });

  it("a second claim of the same job fails once it's already RUNNING — no double-processing", async () => {
    const job = await createJob({ jobType: "ANALYZE_LEAD", runId: randomUUID(), leadId: randomUUID() });

    const first = await claimJob(job.id);
    const second = await claimJob(job.id);

    expect(first?.status).toBe("RUNNING");
    expect(second).toBeNull();
  });

  it("simulates two racing workers — only one wins the claim", async () => {
    const job = await createJob({ jobType: "GENERATE_DEMO", runId: randomUUID(), leadId: randomUUID() });

    const [a, b] = await Promise.all([claimJob(job.id), claimJob(job.id)]);
    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
  });

  it("returns null for a job that doesn't exist", async () => {
    expect(await claimJob(randomUUID())).toBeNull();
  });
});

describe("completeJob / failJob (bounded retry, no infinite loop)", () => {
  it("completes a claimed job and stores its result", async () => {
    const job = await createJob({ jobType: "DEPLOY_DEMO", runId: randomUUID(), leadId: randomUUID() });
    const claimed = await claimJob(job.id);
    const completed = await completeJob(claimed!.id, { deployed: true });

    expect(completed.status).toBe("COMPLETED");
    expect(completed.completed_at).toBeTruthy();
    expect(completed.result).toEqual({ deployed: true });
  });

  it("a first failure goes to RETRY, not FAILED, when attempts remain", async () => {
    const job = await createJob({ jobType: "ANALYZE_LEAD", runId: randomUUID(), leadId: randomUUID(), maxAttempts: 3 });
    const claimed = await claimJob(job.id);
    const failed = await failJob(claimed!, "Upstream unavailable.");

    expect(failed.status).toBe("RETRY");
    expect(failed.attempt_count).toBe(1);
    expect(failed.completed_at).toBeNull();
  });

  it("becomes FAILED for good once max_attempts is exhausted — never retries forever", async () => {
    const job = await createJob({ jobType: "ANALYZE_LEAD", runId: randomUUID(), leadId: randomUUID(), maxAttempts: 1 });
    const claimed = await claimJob(job.id);
    const failed = await failJob(claimed!, "Permanent failure.");

    expect(failed.status).toBe("FAILED");
    expect(failed.attempt_count).toBe(1);
    expect(failed.completed_at).toBeTruthy();
  });

  it("never logs/stores anything beyond the given safe error message", async () => {
    const job = await createJob({ jobType: "ANALYZE_LEAD", runId: randomUUID(), leadId: randomUUID() });
    const claimed = await claimJob(job.id);
    const failed = await failJob(claimed!, "Claude API is temporarily unavailable.");
    expect(failed.error_message).toBe("Claude API is temporarily unavailable.");
    expect(failed.error_message).not.toMatch(/ANTHROPIC_API_KEY|Bearer /i);
  });
});

describe("hasActiveOrCompletedJob (idempotency)", () => {
  it("is false when no job exists for the lead/type", async () => {
    expect(await hasActiveOrCompletedJob(randomUUID(), "ANALYZE_LEAD")).toBe(false);
  });

  it("is true for a PENDING, RUNNING, RETRY, or COMPLETED job", async () => {
    const leadId = randomUUID();
    for (const status of ["PENDING", "RUNNING", "RETRY", "COMPLETED"] as const) {
      fake._seed("automation_jobs", [
        { id: randomUUID(), job_type: "ANALYZE_LEAD", lead_id: leadId, status, attempt_count: 0, max_attempts: 3 },
      ]);
      expect(await hasActiveOrCompletedJob(leadId, "ANALYZE_LEAD")).toBe(true);
    }
  });

  it("is false for a FAILED or CANCELLED job — those don't block a fresh attempt", async () => {
    const leadId = randomUUID();
    fake._seed("automation_jobs", [
      { id: randomUUID(), job_type: "ANALYZE_LEAD", lead_id: leadId, status: "FAILED", attempt_count: 3, max_attempts: 3 },
    ]);
    expect(await hasActiveOrCompletedJob(leadId, "ANALYZE_LEAD")).toBe(false);
  });

  it("doesn't consider a job of a different type", async () => {
    const leadId = randomUUID();
    fake._seed("automation_jobs", [
      { id: randomUUID(), job_type: "GENERATE_DEMO", lead_id: leadId, status: "COMPLETED", attempt_count: 0, max_attempts: 3 },
    ]);
    expect(await hasActiveOrCompletedJob(leadId, "ANALYZE_LEAD")).toBe(false);
  });
});

describe("getPendingJobs", () => {
  it("returns only PENDING jobs due now, oldest first", async () => {
    await createJob({ jobType: "ANALYZE_LEAD", runId: randomUUID(), leadId: randomUUID() });
    const jobs = await getPendingJobs();
    expect(jobs.every((j) => j.status === "PENDING")).toBe(true);
  });
});
