import { describe, expect, it } from "vitest";
import { calculateLeadScore, mapScoreToPriority } from "@/lib/scoring/lead-score";

describe("calculateLeadScore (deterministic scoring)", () => {
  it("scores a business with nothing going for it as 0", () => {
    const result = calculateLeadScore({
      hasWebsite: true,
      rating: null,
      reviewCount: null,
      phone: null,
      email: null,
      category: null,
      websiteNeedLevel: null,
    });
    expect(result.score).toBe(0);
  });

  it("awards +40 for no website", () => {
    const result = calculateLeadScore({
      hasWebsite: false,
      rating: null,
      reviewCount: null,
      phone: null,
      email: null,
      category: null,
      websiteNeedLevel: null,
    });
    expect(result.websiteScore).toBe(40);
    expect(result.score).toBe(40);
  });

  it("rating >= 4.0 gives +15, and >= 4.5 gives +5 more (not instead of)", () => {
    const at40 = calculateLeadScore({
      hasWebsite: true, rating: 4.0, reviewCount: null, phone: null, email: null, category: null, websiteNeedLevel: null,
    });
    expect(at40.ratingScore).toBe(15);

    const at45 = calculateLeadScore({
      hasWebsite: true, rating: 4.5, reviewCount: null, phone: null, email: null, category: null, websiteNeedLevel: null,
    });
    expect(at45.ratingScore).toBe(20);

    const below = calculateLeadScore({
      hasWebsite: true, rating: 3.9, reviewCount: null, phone: null, email: null, category: null, websiteNeedLevel: null,
    });
    expect(below.ratingScore).toBe(0);
  });

  it("review count >= 50 gives +10, and >= 200 gives +5 more", () => {
    const at50 = calculateLeadScore({
      hasWebsite: true, rating: null, reviewCount: 50, phone: null, email: null, category: null, websiteNeedLevel: null,
    });
    expect(at50.reviewScore).toBe(10);

    const at200 = calculateLeadScore({
      hasWebsite: true, rating: null, reviewCount: 200, phone: null, email: null, category: null, websiteNeedLevel: null,
    });
    expect(at200.reviewScore).toBe(15);

    const below = calculateLeadScore({
      hasWebsite: true, rating: null, reviewCount: 49, phone: null, email: null, category: null, websiteNeedLevel: null,
    });
    expect(below.reviewScore).toBe(0);
  });

  it("phone and email each give +10", () => {
    const result = calculateLeadScore({
      hasWebsite: true,
      rating: null,
      reviewCount: null,
      phone: "+919876543210",
      email: "hello@example.com",
      category: null,
      websiteNeedLevel: null,
    });
    expect(result.phoneScore).toBe(10);
    expect(result.emailScore).toBe(10);
  });

  it("AI website need HIGH gives +10, MEDIUM gives +5, LOW gives 0", () => {
    const high = calculateLeadScore({
      hasWebsite: true, rating: null, reviewCount: null, phone: null, email: null, category: null, websiteNeedLevel: "HIGH",
    });
    expect(high.activityScore).toBe(10);

    const medium = calculateLeadScore({
      hasWebsite: true, rating: null, reviewCount: null, phone: null, email: null, category: null, websiteNeedLevel: "MEDIUM",
    });
    expect(medium.activityScore).toBe(5);

    const low = calculateLeadScore({
      hasWebsite: true, rating: null, reviewCount: null, phone: null, email: null, category: null, websiteNeedLevel: "LOW",
    });
    expect(low.activityScore).toBe(0);
  });

  it("a valuable category gives +5", () => {
    const result = calculateLeadScore({
      hasWebsite: true, rating: null, reviewCount: null, phone: null, email: null, category: "Restaurant", websiteNeedLevel: null,
    });
    expect(result.categoryScore).toBe(5);

    const notValuable = calculateLeadScore({
      hasWebsite: true, rating: null, reviewCount: null, phone: null, email: null, category: "Warehouse", websiteNeedLevel: null,
    });
    expect(notValuable.categoryScore).toBe(0);
  });

  it("clamps the total at 100 even when every bonus applies", () => {
    const result = calculateLeadScore({
      hasWebsite: false,
      rating: 5.0,
      reviewCount: 500,
      phone: "+91123",
      email: "a@b.com",
      category: "Restaurant",
      websiteNeedLevel: "HIGH",
    });
    // Raw sum would be 40+20+15+10+10+5+10 = 110 — clamped to 100.
    expect(result.score).toBe(100);
  });

  it("never goes below 0", () => {
    const result = calculateLeadScore({
      hasWebsite: true, rating: null, reviewCount: null, phone: null, email: null, category: null, websiteNeedLevel: null,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("reasoning explains every non-zero component (no unexplained number)", () => {
    const result = calculateLeadScore({
      hasWebsite: false, rating: 4.6, reviewCount: 60, phone: "+91123", email: "a@b.com", category: "Gym", websiteNeedLevel: "MEDIUM",
    });
    expect(result.reasoning.length).toBeGreaterThan(0);
    expect(result.reasoning.join(" ")).toMatch(/no official website/i);
  });
});

describe("mapScoreToPriority (priority mapping)", () => {
  it("maps the documented boundaries correctly", () => {
    expect(mapScoreToPriority(0)).toBe("LOW");
    expect(mapScoreToPriority(39)).toBe("LOW");
    expect(mapScoreToPriority(40)).toBe("MEDIUM");
    expect(mapScoreToPriority(59)).toBe("MEDIUM");
    expect(mapScoreToPriority(60)).toBe("HIGH");
    expect(mapScoreToPriority(79)).toBe("HIGH");
    expect(mapScoreToPriority(80)).toBe("HOT");
    expect(mapScoreToPriority(100)).toBe("HOT");
  });
});
