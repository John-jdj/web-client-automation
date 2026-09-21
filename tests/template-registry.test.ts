import { describe, expect, it } from "vitest";
import { selectTemplate, getTemplateBySlug, TEMPLATES } from "@/lib/templates/registry";

describe("selectTemplate", () => {
  it("matches a restaurant category", () => {
    expect(selectTemplate("Restaurant").slug).toBe("restaurant-cafe");
  });

  it("matches case-insensitively and by substring", () => {
    expect(selectTemplate("Fine Dining Restaurant & Bar").slug).toBe("restaurant-cafe");
    expect(selectTemplate("DENTIST").slug).toBe("health-wellness");
  });

  it("matches health/wellness categories", () => {
    expect(selectTemplate("Hair Salon").slug).toBe("health-wellness");
    expect(selectTemplate("Yoga Studio Fitness Center").slug).toBe("health-wellness");
  });

  it("matches retail categories", () => {
    expect(selectTemplate("Clothing Boutique").slug).toBe("retail-boutique");
  });

  it("falls back to general-business for unmatched or null categories", () => {
    expect(selectTemplate("Warehouse").slug).toBe("general-business");
    expect(selectTemplate(null).slug).toBe("general-business");
  });

  it("general-business is always the last, catch-all entry", () => {
    expect(TEMPLATES[TEMPLATES.length - 1].slug).toBe("general-business");
    expect(TEMPLATES[TEMPLATES.length - 1].keywords).toHaveLength(0);
  });
});

describe("getTemplateBySlug", () => {
  it("returns the matching template", () => {
    expect(getTemplateBySlug("retail-boutique")?.name).toBe("Retail & Boutique");
  });

  it("returns undefined for an unknown slug", () => {
    expect(getTemplateBySlug("does-not-exist")).toBeUndefined();
  });
});
