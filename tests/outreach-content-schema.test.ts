import { describe, expect, it } from "vitest";
import { OutreachCopySchema } from "@/lib/validation/schemas";
import { buildMockOutreachContent } from "@/lib/outreach/mock-content";
import type { OutreachContentInput } from "@/prompts/outreach-generation";

const VERIFIED_INPUT: OutreachContentInput = {
  businessName: "ABC Bakery",
  category: "Bakery",
  city: "Dindigul",
  state: "Tamil Nadu",
  hasWebsite: false,
  businessSummary: "A busy local bakery serving fresh bread daily.",
  likelyServices: ["Custom cakes", "Fresh bread"],
  painPoints: ["No online visibility"],
  personalizationPoints: ["Mention fresh daily bread"],
  demoUrl: "https://abc-bakery.demo-mode.invalid",
};

const FABRICATION_MARKERS = [
  "award",
  "certified",
  "years in business",
  "thousands of customers",
  "5-star",
  "% increase",
  "revenue",
  "guarantee",
];

describe("buildMockOutreachContent (no fabrication, verified-facts only)", () => {
  it("produces content that satisfies OutreachCopySchema", () => {
    const copy = buildMockOutreachContent(VERIFIED_INPUT);
    expect(OutreachCopySchema.safeParse(copy).success).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const a = buildMockOutreachContent(VERIFIED_INPUT);
    const b = buildMockOutreachContent(VERIFIED_INPUT);
    expect(a).toEqual(b);
  });

  it("every personalization point traces back to a verified input field", () => {
    const copy = buildMockOutreachContent(VERIFIED_INPUT);
    const verifiedFacts = [
      ...VERIFIED_INPUT.personalizationPoints,
      ...VERIFIED_INPUT.painPoints,
      VERIFIED_INPUT.category ?? "",
      VERIFIED_INPUT.city ?? "",
      VERIFIED_INPUT.state ?? "",
    ].join(" | ");

    for (const point of copy.personalizationPoints) {
      expect(verifiedFacts).toContain(point);
    }
  });

  it("includes the real demo URL as the CTA when one was supplied, never a fabricated one", () => {
    const copy = buildMockOutreachContent(VERIFIED_INPUT);
    expect(copy.body).toContain(VERIFIED_INPUT.demoUrl);
  });

  it("never mentions a demo when none was supplied", () => {
    const noDemo = buildMockOutreachContent({ ...VERIFIED_INPUT, demoUrl: null });
    expect(noDemo.body).not.toMatch(/https?:\/\//);
  });

  it("never contains fabricated performance/credential claims not present in the input", () => {
    const copy = buildMockOutreachContent(VERIFIED_INPUT);
    const text = `${copy.subject} ${copy.body}`.toLowerCase();
    for (const marker of FABRICATION_MARKERS) {
      expect(text).not.toContain(marker);
    }
  });

  it("falls back to generic, still-non-fabricated copy when analysis fields are empty", () => {
    const sparse: OutreachContentInput = {
      ...VERIFIED_INPUT,
      businessSummary: "",
      personalizationPoints: [],
      painPoints: [],
      demoUrl: null,
    };
    const copy = buildMockOutreachContent(sparse);
    expect(OutreachCopySchema.safeParse(copy).success).toBe(true);
    const text = `${copy.subject} ${copy.body}`.toLowerCase();
    for (const marker of FABRICATION_MARKERS) {
      expect(text).not.toContain(marker);
    }
  });
});

describe("OutreachCopySchema", () => {
  it("rejects content missing a subject or body", () => {
    expect(OutreachCopySchema.safeParse({ subject: "", body: "x", cta: "x", personalizationPoints: ["a"] }).success).toBe(
      false
    );
    expect(OutreachCopySchema.safeParse({ subject: "x", body: "", cta: "x", personalizationPoints: ["a"] }).success).toBe(
      false
    );
  });

  it("rejects content with no personalization points at all", () => {
    const result = OutreachCopySchema.safeParse({ subject: "x", body: "x", cta: "x", personalizationPoints: [] });
    expect(result.success).toBe(false);
  });
});
