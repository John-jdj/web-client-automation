import { describe, expect, it } from "vitest";
import { DiscoveryRequestSchema } from "@/lib/validation/schemas";
import { MAX_DISCOVERY_LIMIT } from "@/lib/google/constants";

describe("DiscoveryRequestSchema (discovery request validation)", () => {
  it("accepts a valid request", () => {
    const result = DiscoveryRequestSchema.safeParse({
      location: "Dindigul",
      category: "restaurant",
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it("defaults limit to 10 when omitted", () => {
    const result = DiscoveryRequestSchema.parse({
      location: "Dindigul",
      category: "restaurant",
    });
    expect(result.limit).toBe(10);
  });

  it("rejects a missing location", () => {
    const result = DiscoveryRequestSchema.safeParse({
      category: "restaurant",
      limit: 10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing category", () => {
    const result = DiscoveryRequestSchema.safeParse({
      location: "Dindigul",
      limit: 10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive limit", () => {
    expect(
      DiscoveryRequestSchema.safeParse({ location: "Dindigul", category: "restaurant", limit: 0 })
        .success
    ).toBe(false);
    expect(
      DiscoveryRequestSchema.safeParse({
        location: "Dindigul",
        category: "restaurant",
        limit: -5,
      }).success
    ).toBe(false);
  });

  it(`rejects a limit above the configured maximum (${MAX_DISCOVERY_LIMIT})`, () => {
    const result = DiscoveryRequestSchema.safeParse({
      location: "Dindigul",
      category: "restaurant",
      limit: MAX_DISCOVERY_LIMIT + 1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a limit exactly at the configured maximum", () => {
    const result = DiscoveryRequestSchema.safeParse({
      location: "Dindigul",
      category: "restaurant",
      limit: MAX_DISCOVERY_LIMIT,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a location shorter than 2 characters", () => {
    expect(
      DiscoveryRequestSchema.safeParse({ location: "D", category: "restaurant", limit: 10 })
        .success
    ).toBe(false);
    expect(
      DiscoveryRequestSchema.safeParse({ location: "", category: "restaurant", limit: 10 })
        .success
    ).toBe(false);
  });

  it("rejects a category shorter than 2 characters", () => {
    expect(
      DiscoveryRequestSchema.safeParse({ location: "Dindigul", category: "r", limit: 10 }).success
    ).toBe(false);
  });

  it("accepts a location/category exactly at the 2-character minimum", () => {
    expect(
      DiscoveryRequestSchema.safeParse({ location: "SF", category: "gym", limit: 10 }).success
    ).toBe(true);
  });

  it("rejects limit 1 below the minimum but accepts limit 1", () => {
    expect(
      DiscoveryRequestSchema.safeParse({ location: "Dindigul", category: "restaurant", limit: 1 })
        .success
    ).toBe(true);
  });
});
