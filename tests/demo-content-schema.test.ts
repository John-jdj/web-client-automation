import { describe, expect, it } from "vitest";
import { DemoContentSchema, DemoCopySchema } from "@/lib/validation/schemas";
import { buildMockDemoContent } from "@/lib/demo/mock-content";
import { buildDemoSlug, slugify } from "@/lib/demo/slug";
import { selectTemplate } from "@/lib/templates/registry";
import type { DemoContentInput } from "@/prompts/demo-generation";

const SAMPLE_INPUT: DemoContentInput = {
  businessName: "ABC Bakery",
  category: "Bakery",
  city: "Dindigul",
  state: "Tamil Nadu",
  businessSummary: "A busy local bakery serving fresh bread daily.",
  targetCustomers: ["Local families"],
  likelyServices: ["Custom cakes", "Fresh bread"],
  painPoints: ["No online visibility"],
  personalizationPoints: ["Mention fresh daily bread", "Family-owned since local demand grew"],
  designStyle: "Warm and rustic",
  templateName: "Restaurant & Cafe",
  servicesLabel: "Menu Highlights",
  ctaKicker: "Order Now",
};

describe("buildMockDemoContent", () => {
  it("produces content that satisfies DemoCopySchema", () => {
    const copy = buildMockDemoContent(SAMPLE_INPUT);
    expect(DemoCopySchema.safeParse(copy).success).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const a = buildMockDemoContent(SAMPLE_INPUT);
    const b = buildMockDemoContent(SAMPLE_INPUT);
    expect(a).toEqual(b);
  });

  it("falls back to generic copy when analysis fields are empty", () => {
    const sparse: DemoContentInput = {
      ...SAMPLE_INPUT,
      businessSummary: "",
      likelyServices: [],
      personalizationPoints: [],
    };
    const copy = buildMockDemoContent(sparse);
    expect(DemoCopySchema.safeParse(copy).success).toBe(true);
    expect(copy.services.length).toBeGreaterThan(0);
    expect(copy.whyChooseUs.length).toBeGreaterThan(0);
  });
});

describe("DemoContentSchema (Step 8 Validate Demo stage)", () => {
  it("accepts a fully assembled demo content object", () => {
    const template = selectTemplate(SAMPLE_INPUT.category);
    const copy = buildMockDemoContent(SAMPLE_INPUT);
    const merged = {
      ...copy,
      templateSlug: template.slug,
      templateName: template.name,
      designStyle: SAMPLE_INPUT.designStyle,
      contactInfo: { phone: "+919876543210", address: "1 Main Street", city: "Dindigul" },
    };
    expect(DemoContentSchema.safeParse(merged).success).toBe(true);
  });

  it("rejects content missing required creative fields", () => {
    const result = DemoContentSchema.safeParse({
      templateSlug: "general-business",
      templateName: "General Business",
      designStyle: "Modern",
      contactInfo: { phone: null, address: null, city: null },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty services array", () => {
    const template = selectTemplate(null);
    const copy = buildMockDemoContent(SAMPLE_INPUT);
    const merged = {
      ...copy,
      services: [],
      templateSlug: template.slug,
      templateName: template.name,
      designStyle: SAMPLE_INPUT.designStyle,
      contactInfo: { phone: null, address: null, city: null },
    };
    expect(DemoContentSchema.safeParse(merged).success).toBe(false);
  });
});

describe("slug helpers", () => {
  it("slugify lowercases and hyphenates", () => {
    expect(slugify("ABC Bakery & Co.")).toBe("abc-bakery-co");
  });

  it("buildDemoSlug is stable for the same business + lead id", () => {
    const a = buildDemoSlug("ABC Bakery", "11111111-2222-3333-4444-555555555555");
    const b = buildDemoSlug("ABC Bakery", "11111111-2222-3333-4444-555555555555");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
