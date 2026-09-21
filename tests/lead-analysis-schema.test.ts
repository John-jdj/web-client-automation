import { describe, expect, it } from "vitest";
import { LeadAnalysisSchema } from "@/lib/validation/schemas";

const VALID_ANALYSIS = {
  businessSummary: "A neighborhood bakery known for fresh bread.",
  businessType: "Bakery",
  targetCustomers: ["Local families", "Office workers"],
  likelyServices: ["Custom cakes", "Daily bread"],
  websiteNeed: { level: "HIGH", reason: "No online presence at all." },
  recommendedPages: ["Home", "Menu", "Contact"],
  recommendedFeatures: ["Online ordering", "Photo gallery"],
  designStyle: "Warm and rustic",
  recommendedColors: ["#8B5E3C", "#F4E1C1"],
  recommendedCTAs: ["Order Now", "Visit Us"],
  painPoints: ["No way for customers to see hours online"],
  personalizationPoints: ["Mention the fresh daily bread"],
};

describe("LeadAnalysisSchema (AI response validation)", () => {
  it("accepts a fully valid response", () => {
    expect(LeadAnalysisSchema.safeParse(VALID_ANALYSIS).success).toBe(true);
  });

  it("rejects a response missing a required field", () => {
    const { businessSummary: _drop, ...rest } = VALID_ANALYSIS;
    void _drop;
    expect(LeadAnalysisSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an invalid websiteNeed.level enum value", () => {
    const invalid = { ...VALID_ANALYSIS, websiteNeed: { level: "EXTREME", reason: "x" } };
    expect(LeadAnalysisSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects array fields that are actually strings", () => {
    const invalid = { ...VALID_ANALYSIS, recommendedPages: "Home, Menu, Contact" };
    expect(LeadAnalysisSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects prose-only / non-JSON-shaped input", () => {
    expect(LeadAnalysisSchema.safeParse("This business seems promising.").success).toBe(false);
  });

  it("rejects completely empty input", () => {
    expect(LeadAnalysisSchema.safeParse({}).success).toBe(false);
  });
});
