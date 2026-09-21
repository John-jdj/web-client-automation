import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/ai/anthropic", () => ({
  analyzeBusiness: vi.fn(),
}));

const { createClient } = await import("@/lib/supabase/server");
const { analyzeBusiness } = await import("@/lib/ai/anthropic");
const { analyzeLead, AnalyzeLeadIneligibleError } = await import("@/lib/ai/analyze-lead");
const { AnalysisError } = await import("@/lib/ai/errors");

let fake: FakeSupabase;

const VALID_AI_RESULT = {
  data: {
    businessSummary: "A busy local bakery.",
    businessType: "Bakery",
    targetCustomers: ["Local families"],
    likelyServices: ["Custom cakes"],
    websiteNeed: { level: "HIGH" as const, reason: "No web presence." },
    recommendedPages: ["Home", "Menu"],
    recommendedFeatures: ["Online ordering"],
    designStyle: "Warm and rustic",
    recommendedColors: ["#8B5E3C"],
    recommendedCTAs: ["Order Now"],
    painPoints: ["No online visibility"],
    personalizationPoints: ["Mention fresh daily bread"],
  },
  provider: "anthropic" as const,
  model: "claude-opus-5",
  promptVersion: "v1",
  rawResponse: { id: "msg_test" },
  usage: { inputTokens: 100, outputTokens: 200 },
};

function seedBusinessAndLead(overrides: {
  businessId: string;
  leadId: string;
  hasWebsite?: boolean;
  leadStatus?: string;
  phone?: string | null;
  email?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  category?: string | null;
}) {
  fake._seed("businesses", [
    {
      id: overrides.businessId,
      business_name: "ABC Bakery",
      category: overrides.category ?? "Bakery",
      has_website: overrides.hasWebsite ?? false,
      phone: overrides.phone ?? "+919876543210",
      email: overrides.email ?? null,
      rating: overrides.rating ?? 4.6,
      review_count: overrides.reviewCount ?? 60,
      address: "1 Main Street",
      city: "Dindigul",
      state: "Tamil Nadu",
      subcategory: null,
    },
  ]);
  fake._seed("leads", [
    {
      id: overrides.leadId,
      business_id: overrides.businessId,
      status: overrides.leadStatus ?? "NEW",
      priority: "MEDIUM",
      lead_score: 0,
      qualification_status: "PENDING",
      created_at: new Date().toISOString(),
    },
  ]);
}

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(fake as never);
  vi.mocked(analyzeBusiness).mockReset();
});

describe("analyzeLead (eligibility)", () => {
  it("rejects a business that already has a website", async () => {
    seedBusinessAndLead({ businessId: "b1", leadId: "l1", hasWebsite: true });
    await expect(analyzeLead("l1")).rejects.toThrow(AnalyzeLeadIneligibleError);
    expect(analyzeBusiness).not.toHaveBeenCalled();
  });

  it("rejects a DO_NOT_CONTACT lead", async () => {
    seedBusinessAndLead({ businessId: "b2", leadId: "l2", leadStatus: "DO_NOT_CONTACT" });
    await expect(analyzeLead("l2")).rejects.toThrow(AnalyzeLeadIneligibleError);
    expect(analyzeBusiness).not.toHaveBeenCalled();
  });

  it("rejects a suppressed business (suppression-list protection)", async () => {
    seedBusinessAndLead({ businessId: "b3", leadId: "l3", phone: "+919000000099" });
    fake._seed("suppression_list", [{ id: "sup1", phone: "+919000000099" }]);
    await expect(analyzeLead("l3")).rejects.toThrow(AnalyzeLeadIneligibleError);
    expect(analyzeBusiness).not.toHaveBeenCalled();
  });
});

describe("analyzeLead (success + scoring + status)", () => {
  it("saves analysis + score and qualifies a strong lead", async () => {
    seedBusinessAndLead({ businessId: "b4", leadId: "l4" });
    vi.mocked(analyzeBusiness).mockResolvedValue(VALID_AI_RESULT);

    const result = await analyzeLead("l4");

    expect(result.alreadyAnalyzed).toBe(false);
    expect(result.status).toBe("QUALIFIED");
    expect(result.qualificationStatus).toBe("QUALIFIED");
    expect(result.leadScore).toBeGreaterThanOrEqual(40);

    const analyses = fake._dump()["lead_analysis"] ?? [];
    const scores = fake._dump()["lead_scores"] ?? [];
    const usage = fake._dump()["api_usage"] ?? [];
    expect(analyses).toHaveLength(1);
    expect(scores).toHaveLength(1);
    expect(usage).toHaveLength(1);
  });

  it("disqualifies a weak lead (low score) without treating it as an error", async () => {
    seedBusinessAndLead({
      businessId: "b5",
      leadId: "l5",
      phone: null,
      rating: null,
      reviewCount: null,
      category: "Warehouse",
    });
    vi.mocked(analyzeBusiness).mockResolvedValue({
      ...VALID_AI_RESULT,
      data: { ...VALID_AI_RESULT.data, websiteNeed: { level: "LOW", reason: "Minimal need." } },
    });

    const result = await analyzeLead("l5");
    expect(result.status).toBe("DISQUALIFIED");
    expect(result.qualificationStatus).toBe("DISQUALIFIED");
    expect(result.leadScore).toBeLessThan(40);
  });
});

describe("analyzeLead (idempotency / duplicate analysis prevention)", () => {
  it("does not call Claude again for an already-analyzed lead", async () => {
    seedBusinessAndLead({ businessId: "b6", leadId: "l6" });
    vi.mocked(analyzeBusiness).mockResolvedValue(VALID_AI_RESULT);

    const first = await analyzeLead("l6");
    expect(first.alreadyAnalyzed).toBe(false);
    expect(analyzeBusiness).toHaveBeenCalledTimes(1);

    const second = await analyzeLead("l6");
    expect(second.alreadyAnalyzed).toBe(true);
    expect(analyzeBusiness).toHaveBeenCalledTimes(1); // still 1 — not called again

    const analyses = fake._dump()["lead_analysis"] ?? [];
    expect(analyses).toHaveLength(1); // no duplicate row
  });

  it("regenerate=true forces a fresh Claude call", async () => {
    seedBusinessAndLead({ businessId: "b7", leadId: "l7" });
    vi.mocked(analyzeBusiness).mockResolvedValue(VALID_AI_RESULT);

    await analyzeLead("l7");
    await analyzeLead("l7", { regenerate: true });

    expect(analyzeBusiness).toHaveBeenCalledTimes(2);
  });
});

describe("analyzeLead (invalid AI response / retry policy)", () => {
  it("retries once on an invalid response, then fails and logs the error without crashing", async () => {
    seedBusinessAndLead({ businessId: "b8", leadId: "l8" });
    vi.mocked(analyzeBusiness).mockRejectedValue(
      new AnalysisError("INVALID_RESPONSE", "Response failed schema validation.", false)
    );

    await expect(analyzeLead("l8")).rejects.toThrow();
    expect(analyzeBusiness).toHaveBeenCalledTimes(2); // one retry, per MAX_ATTEMPTS

    const errorLogs = fake._dump()["error_logs"] ?? [];
    expect(errorLogs).toHaveLength(1);

    const leads = fake._dump()["leads"] as Array<{ id: string; status: string }>;
    const lead = leads.find((l) => l.id === "l8");
    expect(lead?.status).toBe("NEW"); // reverted, not left at ANALYZING or DISQUALIFIED
  });

  it("does not retry a non-retryable auth failure", async () => {
    seedBusinessAndLead({ businessId: "b9", leadId: "l9" });
    vi.mocked(analyzeBusiness).mockRejectedValue(
      new AnalysisError("AUTH_FAILED", "Claude API authentication failed.", false)
    );

    await expect(analyzeLead("l9")).rejects.toThrow();
    expect(analyzeBusiness).toHaveBeenCalledTimes(1); // no retry for auth failures
  });

  it("retries a transient quota error and succeeds on the second attempt", async () => {
    seedBusinessAndLead({ businessId: "b10", leadId: "l10" });
    vi.mocked(analyzeBusiness)
      .mockRejectedValueOnce(new AnalysisError("QUOTA_EXCEEDED", "Rate limited.", true))
      .mockResolvedValueOnce(VALID_AI_RESULT);

    const result = await analyzeLead("l10");
    expect(result.alreadyAnalyzed).toBe(false);
    expect(analyzeBusiness).toHaveBeenCalledTimes(2);
  });
});
