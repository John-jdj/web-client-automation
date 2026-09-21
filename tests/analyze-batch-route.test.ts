import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
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

const { createClient } = await import("@/lib/supabase/server");
const { analyzeLead, AnalyzeLeadIneligibleError } = await import("@/lib/ai/analyze-lead");
const { AnalysisError } = await import("@/lib/ai/errors");
const { POST } = await import("@/app/api/leads/analyze-batch/route");

let fake: FakeSupabase;

function seedSettings(overrides: Partial<{ daily_ai_limit: number; ai_analysis_enabled: boolean }> = {}) {
  fake._seed("automation_settings", [
    {
      id: "settings_1",
      enabled: false,
      ai_analysis_enabled: true,
      daily_ai_limit: 50,
      ...overrides,
    },
  ]);
}

function seedCandidateLeads(ids: string[]) {
  fake._seed(
    "leads",
    ids.map((id) => ({
      id,
      status: "NEW",
      businesses: { has_website: false },
      created_at: new Date().toISOString(),
    }))
  );
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/leads/analyze-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(fake as never);
  vi.mocked(analyzeLead).mockReset();
});

describe("POST /api/leads/analyze-batch (partial failure handling)", () => {
  it("continues after one lead fails and reports success/failure counts separately", async () => {
    seedSettings();
    seedCandidateLeads(["lead1", "lead2", "lead3", "lead4"]);

    vi.mocked(analyzeLead).mockImplementation(async (leadId: string) => {
      if (leadId === "lead3") {
        throw new AnalysisError("UPSTREAM_UNAVAILABLE", "Claude API is temporarily unavailable.", true);
      }
      return {
        alreadyAnalyzed: false,
        leadId,
        status: "QUALIFIED",
        qualificationStatus: "QUALIFIED",
        leadScore: 72,
        priority: "HIGH",
        analysisId: `analysis_${leadId}`,
        scoreId: `score_${leadId}`,
      };
    });

    const response = await POST(postRequest({ limit: 10 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.analyzed).toBe(3);
    expect(body.summary.failed).toBe(1);
    expect(analyzeLead).toHaveBeenCalledTimes(4); // all 4 attempted — one failure didn't stop the batch
  });

  it("treats ineligible leads (suppressed/DO_NOT_CONTACT/etc.) as skipped, not failed", async () => {
    seedSettings();
    seedCandidateLeads(["lead5"]);

    vi.mocked(analyzeLead).mockRejectedValue(
      new AnalyzeLeadIneligibleError("SUPPRESSED", "This business is on the suppression list.")
    );

    const response = await POST(postRequest({ limit: 10 }));
    const body = await response.json();

    expect(body.summary.skipped).toBe(1);
    expect(body.summary.failed).toBe(0);
  });
});

describe("POST /api/leads/analyze-batch (daily AI limit)", () => {
  it("respects daily_ai_limit and does not exceed it", async () => {
    seedSettings({ daily_ai_limit: 2 });
    seedCandidateLeads(["lead6", "lead7", "lead8", "lead9"]);

    vi.mocked(analyzeLead).mockImplementation(async (leadId: string) => ({
      alreadyAnalyzed: false,
      leadId,
      status: "QUALIFIED",
      qualificationStatus: "QUALIFIED",
      leadScore: 60,
      priority: "HIGH",
      analysisId: `a_${leadId}`,
      scoreId: `s_${leadId}`,
    }));

    const response = await POST(postRequest({ limit: 10 }));
    const body = await response.json();

    expect(body.summary.analyzed).toBe(2); // capped at daily_ai_limit, not the requested 10
  });

  it("accounts for usage already logged today before allowing more", async () => {
    seedSettings({ daily_ai_limit: 2 });
    seedCandidateLeads(["lead10", "lead11"]);
    fake._seed("api_usage", [
      { id: "u1", provider: "anthropic", operation: "business_analysis", created_at: new Date().toISOString() },
      { id: "u2", provider: "anthropic", operation: "business_analysis", created_at: new Date().toISOString() },
    ]);

    const response = await POST(postRequest({ limit: 10 }));
    const body = await response.json();

    expect(body.summary.analyzed).toBe(0);
    expect(body.message).toMatch(/daily ai analysis limit reached/i);
    expect(analyzeLead).not.toHaveBeenCalled();
  });

  it("does not call Claude at all when ai_analysis_enabled is false", async () => {
    seedSettings({ ai_analysis_enabled: false });
    seedCandidateLeads(["lead12"]);

    const response = await POST(postRequest({ limit: 10 }));
    const body = await response.json();

    expect(body.summary.analyzed).toBe(0);
    expect(analyzeLead).not.toHaveBeenCalled();
  });
});

describe("POST /api/leads/analyze-batch (auth)", () => {
  it("rejects unauthenticated requests", async () => {
    fake._setUser(null);
    const response = await POST(postRequest({ limit: 10 }));
    expect(response.status).toBe(401);
  });

  it("rejects an invalid request body", async () => {
    seedSettings();
    const response = await POST(postRequest({ limit: -5 }));
    expect(response.status).toBe(400);
  });
});
