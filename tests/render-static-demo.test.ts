import { describe, expect, it } from "vitest";
import { renderStaticDemoHtml } from "@/lib/vercel/render-static-demo";
import type { DemoContentOutput } from "@/lib/validation/schemas";

const CONTENT: DemoContentOutput = {
  tagline: "ABC Bakery — Bakery in Dindigul",
  heroHeadline: "Welcome to ABC Bakery",
  heroSubheadline: "A busy local bakery.",
  aboutText: "A busy local bakery serving fresh bread daily.",
  services: [{ title: "Custom cakes", description: "Order a custom cake for any occasion." }],
  whyChooseUs: ["Fresh daily", "Friendly staff"],
  ctaText: "Order Now",
  templateSlug: "restaurant-cafe",
  templateName: "Restaurant & Cafe",
  designStyle: "Warm and rustic",
  contactInfo: { phone: "+919876543210", address: "1 Main Street", city: "Dindigul" },
};

describe("renderStaticDemoHtml (public deployment content)", () => {
  it("includes every DemoContentOutput field meant to be public", () => {
    const html = renderStaticDemoHtml("ABC Bakery", CONTENT);

    expect(html).toContain("Welcome to ABC Bakery");
    expect(html).toContain("A busy local bakery.");
    expect(html).toContain("Custom cakes");
    expect(html).toContain("Fresh daily");
    expect(html).toContain("Order Now");
    expect(html).toContain("+919876543210");
    expect(html).toContain("1 Main Street");
    expect(html).toContain("Dindigul");
  });

  it("never contains secret-shaped strings or env var names", () => {
    const html = renderStaticDemoHtml("ABC Bakery", CONTENT);

    expect(html).not.toMatch(/sk-ant-|vercel_token|VERCEL_TOKEN|SUPABASE_SECRET_KEY|ANTHROPIC_API_KEY|Bearer /i);
  });

  it("never contains internal CRM/identifier field names (only rendered copy, no raw JSON of the row)", () => {
    const html = renderStaticDemoHtml("ABC Bakery", CONTENT);

    // A leak would look like the raw demo/lead/business row being
    // serialized into the page — these field names never appear in the
    // template markup itself, only interpolated values do.
    for (const forbidden of [
      "lead_score",
      "qualification_status",
      "business_id",
      "google_place_id",
      "raw_response",
      "lead_id",
      "\"id\":",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("escapes HTML special characters in user/AI-supplied content (no injection)", () => {
    const html = renderStaticDemoHtml("<script>alert(1)</script>", {
      ...CONTENT,
      heroHeadline: '<img src=x onerror="alert(1)">',
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;script&gt;");
  });

  it("falls back to the general-business template when templateSlug is unrecognized", () => {
    const html = renderStaticDemoHtml("ABC Bakery", { ...CONTENT, templateSlug: "nonexistent-slug" });
    expect(html).toContain("General Business");
  });
});
