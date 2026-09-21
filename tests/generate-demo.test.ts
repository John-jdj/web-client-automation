import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/demo/generate-demo-content", () => ({
  generateDemoContent: vi.fn(),
}));

const { createClient } = await import("@/lib/supabase/server");
const { generateDemoContent } = await import("@/lib/demo/generate-demo-content");
const { generateDemo, GenerateDemoIneligibleError } = await import("@/lib/demo/generate-demo");
const { AnalysisError } = await import("@/lib/ai/errors");

let fake: FakeSupabase;

const VALID_COPY = {
  tagline: "ABC Bakery — Bakery in Dindigul",
  heroHeadline: "Welcome to ABC Bakery",
  heroSubheadline: "A busy local bakery.",
  aboutText: "A busy local bakery serving fresh bread daily.",
  services: [{ title: "Custom cakes", description: "Order a custom cake for any occasion." }],
  whyChooseUs: ["Fresh daily", "Friendly staff", "Local favorite"],
  ctaText: "Order Now",
};

function seedFullPipeline(overrides: {
  businessId: string;
  leadId: string;
  qualificationStatus?: string;
  hasAnalysis?: boolean;
  category?: string;
}) {
  fake._seed("businesses", [
    {
      id: overrides.businessId,
      business_name: "ABC Bakery",
      category: overrides.category ?? "Bakery",
      has_website: false,
      phone: "+919876543210",
      address: "1 Main Street",
      city: "Dindigul",
      state: "Tamil Nadu",
    },
  ]);
  fake._seed("leads", [
    {
      id: overrides.leadId,
      business_id: overrides.businessId,
      status: "QUALIFIED",
      priority: "HIGH",
      lead_score: 70,
      qualification_status: overrides.qualificationStatus ?? "QUALIFIED",
      created_at: new Date().toISOString(),
    },
  ]);
  if (overrides.hasAnalysis !== false) {
    fake._seed("lead_analysis", [
      {
        id: "analysis_" + overrides.leadId,
        lead_id: overrides.leadId,
        business_summary: "A busy local bakery.",
        target_customer: "Local families",
        services: ["Custom cakes"],
        pain_points: ["No online visibility"],
        personalization_points: ["Mention fresh daily bread"],
        design_style: "Warm and rustic",
        created_at: new Date().toISOString(),
      },
    ]);
  }
}

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(fake as never);
  vi.mocked(generateDemoContent).mockReset();
});

describe("generateDemo (eligibility)", () => {
  it("rejects a lead that has not been qualified", async () => {
    seedFullPipeline({ businessId: "b1", leadId: "l1", qualificationStatus: "PENDING" });
    await expect(generateDemo("l1")).rejects.toThrow(GenerateDemoIneligibleError);
    expect(generateDemoContent).not.toHaveBeenCalled();
  });

  it("rejects a qualified lead with no analysis yet", async () => {
    seedFullPipeline({ businessId: "b2", leadId: "l2", hasAnalysis: false });
    await expect(generateDemo("l2")).rejects.toThrow(GenerateDemoIneligibleError);
    expect(generateDemoContent).not.toHaveBeenCalled();
  });

  it("rejects an unknown lead id", async () => {
    await expect(generateDemo("missing")).rejects.toThrow(GenerateDemoIneligibleError);
  });
});

describe("generateDemo (template selection + success)", () => {
  it("selects the restaurant-cafe template for a bakery and saves a validated demo", async () => {
    seedFullPipeline({ businessId: "b3", leadId: "l3", category: "Bakery" });
    vi.mocked(generateDemoContent).mockResolvedValue({
      data: VALID_COPY,
      usedMock: true,
      model: null,
      promptVersion: "v1",
      usage: null,
    });

    const result = await generateDemo("l3");

    expect(result.alreadyGenerated).toBe(false);
    expect(result.templateSlug).toBe("restaurant-cafe");
    expect(result.usedMock).toBe(true);
    expect(result.previewPath).toBe(`/demo/${result.demoId}`);

    const demos = fake._dump()["demos"] as Array<{ generated_content: unknown; status: string }>;
    expect(demos).toHaveLength(1);
    expect(demos[0].status).toBe("GENERATED");

    const leads = fake._dump()["leads"] as Array<{ id: string; status: string }>;
    expect(leads.find((l) => l.id === "l3")?.status).toBe("DEMO_CREATED");
  });

  it("falls back to general-business for an unmatched category", async () => {
    seedFullPipeline({ businessId: "b4", leadId: "l4", category: "Warehouse" });
    vi.mocked(generateDemoContent).mockResolvedValue({
      data: VALID_COPY,
      usedMock: true,
      model: null,
      promptVersion: "v1",
      usage: null,
    });

    const result = await generateDemo("l4");
    expect(result.templateSlug).toBe("general-business");
  });
});

describe("generateDemo (idempotency)", () => {
  it("does not regenerate content for an already-generated demo", async () => {
    seedFullPipeline({ businessId: "b5", leadId: "l5" });
    vi.mocked(generateDemoContent).mockResolvedValue({
      data: VALID_COPY,
      usedMock: true,
      model: null,
      promptVersion: "v1",
      usage: null,
    });

    const first = await generateDemo("l5");
    expect(first.alreadyGenerated).toBe(false);
    expect(generateDemoContent).toHaveBeenCalledTimes(1);

    const second = await generateDemo("l5");
    expect(second.alreadyGenerated).toBe(true);
    expect(second.demoId).toBe(first.demoId);
    expect(generateDemoContent).toHaveBeenCalledTimes(1);
  });

  it("regenerate=true forces a fresh content generation", async () => {
    seedFullPipeline({ businessId: "b6", leadId: "l6" });
    vi.mocked(generateDemoContent).mockResolvedValue({
      data: VALID_COPY,
      usedMock: true,
      model: null,
      promptVersion: "v1",
      usage: null,
    });

    await generateDemo("l6");
    await generateDemo("l6", { regenerate: true });
    expect(generateDemoContent).toHaveBeenCalledTimes(2);
  });
});

describe("generateDemo (invalid content / retry policy)", () => {
  it("retries once on invalid content, then fails and reverts lead status", async () => {
    seedFullPipeline({ businessId: "b7", leadId: "l7" });
    vi.mocked(generateDemoContent).mockRejectedValue(
      new AnalysisError("INVALID_RESPONSE", "Response failed schema validation.", false)
    );

    await expect(generateDemo("l7")).rejects.toThrow();
    expect(generateDemoContent).toHaveBeenCalledTimes(2);

    const errorLogs = fake._dump()["error_logs"] ?? [];
    expect(errorLogs).toHaveLength(1);

    const leads = fake._dump()["leads"] as Array<{ id: string; status: string }>;
    expect(leads.find((l) => l.id === "l7")?.status).toBe("QUALIFIED");

    const demos = fake._dump()["demos"] ?? [];
    expect(demos).toHaveLength(0);
  });

  it("rejects content that fails DemoContentSchema validation even if the provider call succeeded", async () => {
    seedFullPipeline({ businessId: "b8", leadId: "l8" });
    vi.mocked(generateDemoContent).mockResolvedValue({
      data: { ...VALID_COPY, services: [] },
      usedMock: true,
      model: null,
      promptVersion: "v1",
      usage: null,
    });

    await expect(generateDemo("l8")).rejects.toThrow();
    const demos = fake._dump()["demos"] ?? [];
    expect(demos).toHaveLength(0);
  });
});
