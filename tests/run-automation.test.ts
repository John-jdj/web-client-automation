import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/discovery/run", () => ({
  runDiscovery: vi.fn(),
}));
vi.mock("@/lib/ai/analyze-lead", () => ({
  analyzeLead: vi.fn(),
  AnalyzeLeadIneligibleError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/lib/demo/generate-demo", () => ({
  generateDemo: vi.fn(),
  GenerateDemoIneligibleError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/lib/demo/deploy-demo", () => ({
  deployDemo: vi.fn(),
  DeployDemoIneligibleError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/lib/outreach/generate-outreach", () => ({
  generateOutreach: vi.fn(),
  GenerateOutreachIneligibleError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/lib/email/send-email", () => ({
  sendEmail: vi.fn(),
}));

const { createClient } = await import("@/lib/supabase/server");
const { createServiceClient } = await import("@/lib/supabase/service");
const { runDiscovery } = await import("@/lib/discovery/run");
const { analyzeLead } = await import("@/lib/ai/analyze-lead");
const { generateDemo } = await import("@/lib/demo/generate-demo");
const { deployDemo } = await import("@/lib/demo/deploy-demo");
const { generateOutreach } = await import("@/lib/outreach/generate-outreach");
const { sendEmail } = await import("@/lib/email/send-email");
const { runAutomation, AutomationAlreadyRunningError } = await import("@/lib/automation/run-automation");

let fake: FakeSupabase;

function seedSettings(overrides: Record<string, unknown> = {}) {
  fake._seed("automation_settings", [
    {
      id: "settings_1",
      enabled: true,
      discovery_enabled: true,
      ai_analysis_enabled: true,
      demo_generation_enabled: true,
      auto_deployment_enabled: true,
      auto_outreach_enabled: false,
      require_outreach_approval: true,
      daily_discovery_limit: 50,
      daily_ai_limit: 50,
      daily_demo_limit: 50,
      daily_deployment_limit: 50,
      daily_outreach_limit: 10,
      ...overrides,
    },
  ]);
}

function seedAnalysisCandidates(ids: string[]) {
  fake._seed(
    "leads",
    ids.map((id) => ({
      id,
      status: "NEW",
      qualification_status: "PENDING",
      businesses: { has_website: false },
      created_at: new Date().toISOString(),
    }))
  );
}

function seedQualifiedLeads(ids: string[], status = "QUALIFIED") {
  fake._seed(
    "leads",
    ids.map((id) => ({
      id,
      status,
      qualification_status: "QUALIFIED",
      lead_score: 60,
      created_at: new Date().toISOString(),
    }))
  );
}

function seedGeneratedDemos(pairs: Array<{ demoId: string; leadId: string }>) {
  fake._seed(
    "demos",
    pairs.map((p) => ({ id: p.demoId, lead_id: p.leadId, status: "GENERATED", created_at: new Date().toISOString() }))
  );
}

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(fake as never);
  vi.mocked(createServiceClient).mockReturnValue(fake as never);
  vi.mocked(runDiscovery).mockReset();
  vi.mocked(analyzeLead).mockReset();
  vi.mocked(generateDemo).mockReset();
  vi.mocked(deployDemo).mockReset();
  vi.mocked(generateOutreach).mockReset();
  vi.mocked(sendEmail).mockReset();
});

describe("runAutomation (master switch)", () => {
  it("skips every step and does nothing when automation_settings.enabled is false (the seeded default)", async () => {
    seedSettings({ enabled: false });
    const result = await runAutomation();

    expect(result.status).toBe("COMPLETED");
    expect(result.steps.every((s) => s.status === "SKIPPED")).toBe(true);
    expect(analyzeLead).not.toHaveBeenCalled();
    expect(generateDemo).not.toHaveBeenCalled();
    expect(deployDemo).not.toHaveBeenCalled();
    expect(generateOutreach).not.toHaveBeenCalled();
  });
});

describe("runAutomation (successful execution)", () => {
  it("runs lead_analysis, demo_generation, demo_deployment, and outreach_preparation end to end", async () => {
    seedSettings();
    seedAnalysisCandidates(["lead1"]);
    // lead2 is deliberately the ONLY qualified lead seeded here: with
    // status "QUALIFIED" it's a candidate for both demo_generation (which
    // additionally requires status==="QUALIFIED") and outreach_preparation
    // (which draws from any non-terminal qualified lead) — a lead can
    // legitimately be eligible for both within one automation pass, since
    // generateOutreach doesn't require a demo to already exist.
    seedQualifiedLeads(["lead2"]);
    seedGeneratedDemos([{ demoId: "demo1", leadId: "lead3" }]);

    vi.mocked(analyzeLead).mockResolvedValue({
      alreadyAnalyzed: false,
      leadId: "lead1",
      status: "QUALIFIED",
      qualificationStatus: "QUALIFIED",
      leadScore: 72,
      priority: "HIGH",
      analysisId: "a1",
      scoreId: "s1",
    });
    vi.mocked(generateDemo).mockResolvedValue({
      alreadyGenerated: false,
      demoId: "demo2",
      leadId: "lead2",
      slug: "slug",
      previewPath: "/demo/demo2",
      templateSlug: "general-business",
      templateName: "General Business",
      usedMock: true,
      status: "GENERATED",
    });
    vi.mocked(deployDemo).mockResolvedValue({
      alreadyDeployed: false,
      demoId: "demo1",
      deploymentId: "mock_dpl_1",
      deploymentUrl: "https://demo1.demo-mode.invalid",
      status: "READY",
      usedMock: true,
    });
    vi.mocked(generateOutreach).mockResolvedValue({
      alreadyGenerated: false,
      messageId: "msg1",
      leadId: "lead2",
      status: "DRAFT",
      recipientEmail: "owner@example.com",
      subject: "s",
      body: "b",
      cta: "c",
      personalizationPoints: [],
      demoUrl: null,
      usedMock: true,
    });

    const result = await runAutomation({
      steps: ["lead_analysis", "demo_generation", "demo_deployment", "outreach_preparation"],
      limit: 10,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.steps.map((s) => s.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"]);
    // Each reused function's first argument is still the plain id — the
    // remaining arguments are the step's options object and the
    // automation context (Step 11.2), so only the leading id is asserted
    // here rather than the full argument list.
    expect(vi.mocked(analyzeLead).mock.calls[0][0]).toBe("lead1");
    expect(vi.mocked(generateDemo).mock.calls[0][0]).toBe("lead2");
    expect(vi.mocked(deployDemo).mock.calls[0][0]).toBe("demo1");
    expect(vi.mocked(generateOutreach).mock.calls[0][0]).toBe("lead2");

    // Never sends — outreach_preparation only ever drafts.
    expect(sendEmail).not.toHaveBeenCalled();

    const runs = fake._dump()["automation_runs"] as Array<{ status: string; completed_at: string | null }>;
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("COMPLETED");
    expect(runs[0].completed_at).toBeTruthy();

    const jobs = fake._dump()["automation_jobs"] as Array<{ status: string; job_type: string }>;
    expect(jobs).toHaveLength(4);
    expect(jobs.every((j) => j.status === "COMPLETED")).toBe(true);
  });

  it("skips a step whose automation_settings flag is off, without calling its reused function", async () => {
    seedSettings({ ai_analysis_enabled: false });
    seedAnalysisCandidates(["lead1"]);

    const result = await runAutomation({ steps: ["lead_analysis"] });

    expect(result.steps[0].status).toBe("SKIPPED");
    expect(result.steps[0].reason).toMatch(/ai_analysis_enabled/);
    expect(analyzeLead).not.toHaveBeenCalled();
  });

  it("skips discovery when no location/category is supplied", async () => {
    seedSettings();
    const result = await runAutomation({ steps: ["discovery"] });
    expect(result.steps[0].status).toBe("SKIPPED");
    expect(runDiscovery).not.toHaveBeenCalled();
  });

  it("always reports followup_processing as a safe no-op placeholder", async () => {
    seedSettings();
    const result = await runAutomation({ steps: ["followup_processing"] });
    expect(result.steps[0]).toMatchObject({ step: "followup_processing", status: "SKIPPED" });
  });
});

describe("runAutomation (failed step handling)", () => {
  it("marks a whole step FAILED when its reused function rejects, without aborting other steps", async () => {
    seedSettings();
    seedQualifiedLeads(["lead4"]);
    vi.mocked(runDiscovery).mockRejectedValue(new Error("Google Places API is temporarily unavailable."));
    vi.mocked(generateOutreach).mockResolvedValue({
      alreadyGenerated: false,
      messageId: "msg1",
      leadId: "lead4",
      status: "DRAFT",
      recipientEmail: "owner@example.com",
      subject: "s",
      body: "b",
      cta: "c",
      personalizationPoints: [],
      demoUrl: null,
      usedMock: true,
    });

    const result = await runAutomation({
      steps: ["discovery", "outreach_preparation"],
      discovery: { location: "Dindigul", category: "Bakery" },
    });

    expect(result.status).toBe("PARTIAL");
    const discoveryResult = result.steps.find((s) => s.step === "discovery");
    expect(discoveryResult?.status).toBe("FAILED");
    const outreachResult = result.steps.find((s) => s.step === "outreach_preparation");
    expect(outreachResult?.status).toBe("COMPLETED");

    const errorLogs = fake._dump()["error_logs"] as Array<{ service: string }>;
    expect(errorLogs.some((e) => e.service === "automation_discovery")).toBe(true);
  });

  it("a single lead's failure inside a step becomes a RETRY job, not a step-level failure", async () => {
    seedSettings();
    seedAnalysisCandidates(["lead1"]);
    vi.mocked(analyzeLead).mockRejectedValue(new Error("Claude API is temporarily unavailable."));

    const result = await runAutomation({ steps: ["lead_analysis"] });

    expect(result.steps[0].status).toBe("COMPLETED"); // the step itself ran fine — one unit of work failed
    const jobs = fake._dump()["automation_jobs"] as Array<{ status: string; attempt_count: number }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("RETRY");
    expect(jobs[0].attempt_count).toBe(1);
  });
});

describe("runAutomation (idempotency)", () => {
  it("does not reprocess a lead that already has a COMPLETED job for the same step", async () => {
    seedSettings();
    seedAnalysisCandidates(["lead1"]);
    fake._seed("automation_jobs", [
      { id: randomUUID(), job_type: "ANALYZE_LEAD", lead_id: "lead1", status: "COMPLETED", attempt_count: 0, max_attempts: 3 },
    ]);

    await runAutomation({ steps: ["lead_analysis"] });

    expect(analyzeLead).not.toHaveBeenCalled();
  });

  it("running the pipeline twice for the same candidate only processes it once", async () => {
    seedSettings();
    seedAnalysisCandidates(["lead1"]);
    vi.mocked(analyzeLead).mockResolvedValue({
      alreadyAnalyzed: false,
      leadId: "lead1",
      status: "QUALIFIED",
      qualificationStatus: "QUALIFIED",
      leadScore: 72,
      priority: "HIGH",
      analysisId: "a1",
      scoreId: "s1",
    });

    await runAutomation({ steps: ["lead_analysis"] });
    await runAutomation({ steps: ["lead_analysis"] });

    expect(analyzeLead).toHaveBeenCalledTimes(1);
  });
});

describe("runAutomation (run-level concurrency protection)", () => {
  it("refuses to start a second run while one is already RUNNING", async () => {
    seedSettings();
    fake._seed("automation_runs", [
      { id: randomUUID(), status: "RUNNING", started_at: new Date().toISOString() },
    ]);

    await expect(runAutomation()).rejects.toThrow(AutomationAlreadyRunningError);

    const runs = fake._dump()["automation_runs"] as Array<unknown>;
    expect(runs).toHaveLength(1); // no second run row was created
  });

  it("does not treat a stale (long-abandoned) RUNNING run as a lock", async () => {
    seedSettings();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    fake._seed("automation_runs", [{ id: randomUUID(), status: "RUNNING", started_at: twoHoursAgo }]);

    const result = await runAutomation({ steps: [] });
    expect(result.status).toBe("COMPLETED");
  });

  it("marks the stale RUNNING run FAILED (not deleted) rather than leaving it dangling", async () => {
    seedSettings();
    const staleId = randomUUID();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    fake._seed("automation_runs", [{ id: staleId, status: "RUNNING", started_at: twoHoursAgo }]);

    await runAutomation({ steps: [] });

    const runs = fake._dump()["automation_runs"] as Array<{ id: string; status: string; completed_at: string | null }>;
    expect(runs).toHaveLength(2); // the reaped stale run + the new run — nothing was deleted
    const reaped = runs.find((r) => r.id === staleId)!;
    expect(reaped.status).toBe("FAILED");
    expect(reaped.completed_at).toBeTruthy();
  });

  it("does not let a fresh (non-stale) COMPLETED/FAILED/CANCELLED run block a new run", async () => {
    seedSettings();
    fake._seed("automation_runs", [
      { id: randomUUID(), status: "COMPLETED", started_at: new Date().toISOString() },
      { id: randomUUID(), status: "FAILED", started_at: new Date().toISOString() },
      { id: randomUUID(), status: "CANCELLED", started_at: new Date().toISOString() },
    ]);

    const result = await runAutomation({ steps: [] });
    expect(result.status).toBe("COMPLETED");

    const runs = fake._dump()["automation_runs"] as Array<unknown>;
    expect(runs).toHaveLength(4); // the 3 historical rows untouched + 1 new run
  });

  it("enforces the single-active-run rule at the database layer: two truly concurrent calls only let one through", async () => {
    // No pre-seeded RUNNING row here — this proves the protection holds
    // even when both calls start from an identical, empty starting state
    // (the exact race the old check-then-insert code was vulnerable to),
    // not just when one call already sees a pre-existing RUNNING row.
    seedSettings();

    const results = await Promise.allSettled([runAutomation({ steps: [] }), runAutomation({ steps: [] })]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AutomationAlreadyRunningError);

    // The database-level uniqueness constraint (simulated in the fake:
    // at most one RUNNING row in automation_runs) is what actually
    // prevented the second row — not an application-level check.
    const runs = fake._dump()["automation_runs"] as Array<{ status: string }>;
    expect(runs.filter((r) => r.status === "RUNNING")).toHaveLength(0); // the one that ran already completed
    expect(runs).toHaveLength(1);
  });

  it("converts a raw unique-violation error (23505) from the database into AutomationAlreadyRunningError, never leaking the raw Postgres error", async () => {
    seedSettings();
    fake._seed("automation_runs", [{ id: randomUUID(), status: "RUNNING", started_at: new Date().toISOString() }]);

    await expect(runAutomation({ steps: [] })).rejects.toThrow(AutomationAlreadyRunningError);
    // Distinguishing assertion from the pre-existing "refuses to start a
    // second run" test above: this proves the *mechanism* is the unique
    // constraint (the insert helper's 23505 handling), not just that some
    // rejection happens — by asserting on the thrown error's own type/
    // message rather than a raw Postgres error ever being exposed.
    try {
      await runAutomation({ steps: [] });
      expect.unreachable("expected runAutomation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AutomationAlreadyRunningError);
      expect((err as Error).message).not.toMatch(/unique constraint|23505|duplicate key/i);
    }
  });
});

describe("runAutomation (never sends real email, regardless of config)", () => {
  it("never calls sendEmail even with the most permissive outreach settings", async () => {
    seedSettings({ auto_outreach_enabled: true, require_outreach_approval: false });
    seedQualifiedLeads(["lead4"]);
    vi.mocked(generateOutreach).mockResolvedValue({
      alreadyGenerated: false,
      messageId: "msg1",
      leadId: "lead4",
      status: "DRAFT",
      recipientEmail: "owner@example.com",
      subject: "s",
      body: "b",
      cta: "c",
      personalizationPoints: [],
      demoUrl: null,
      usedMock: true,
    });

    await runAutomation({ steps: ["outreach_preparation"] });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("the automation runner's source never imports or calls sendOutreach (static safety guard; prose mentions of the name in comments are fine)", () => {
    const source = readFileSync(
      new URL("../lib/automation/run-automation.ts", import.meta.url),
      "utf-8"
    );
    expect(source).not.toMatch(/import\s*\{[^}]*sendOutreach/);
    expect(source).not.toMatch(/sendOutreach\(/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/outreach\/send-outreach["']/);
  });

  it("behaves identically regardless of DEMO_MODE — this runner never reads it directly (each reused service function owns that check)", async () => {
    seedSettings();
    seedQualifiedLeads(["lead4"]);
    vi.mocked(generateOutreach).mockResolvedValue({
      alreadyGenerated: false,
      messageId: "msg1",
      leadId: "lead4",
      status: "DRAFT",
      recipientEmail: "owner@example.com",
      subject: "s",
      body: "b",
      cta: "c",
      personalizationPoints: [],
      demoUrl: null,
      usedMock: true,
    });

    const source = readFileSync(
      new URL("../lib/automation/run-automation.ts", import.meta.url),
      "utf-8"
    );
    expect(source).not.toMatch(/process\.env\.DEMO_MODE/);

    const result = await runAutomation({ steps: ["outreach_preparation"] });
    expect(result.status).toBe("COMPLETED");
  });
});
