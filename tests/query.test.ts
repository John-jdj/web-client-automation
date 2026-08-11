import { describe, expect, it } from "vitest";
import { buildTextQuery, mapCategoryToIncludedType } from "@/lib/google/query";

describe("buildTextQuery", () => {
  it("combines category and location", () => {
    expect(buildTextQuery({ location: "Dindigul", category: "restaurant" })).toBe(
      "restaurant in Dindigul"
    );
  });

  it("prefers an explicit query override", () => {
    expect(
      buildTextQuery({ query: "salons in Dindigul", location: "Madurai", category: "gym" })
    ).toBe("salons in Dindigul");
  });

  it("sanitizes malformed input instead of blindly concatenating it", () => {
    expect(
      buildTextQuery({ location: "Dindigul\n\t  ", category: "  restaurant   shop  " })
    ).toBe("restaurant shop in Dindigul");
  });

  it("caps overly long input", () => {
    const longCategory = "a".repeat(500);
    const result = buildTextQuery({ category: longCategory });
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it("returns an empty string when nothing usable is provided", () => {
    expect(buildTextQuery({})).toBe("");
  });
});

describe("mapCategoryToIncludedType", () => {
  it("maps known categories case-insensitively", () => {
    expect(mapCategoryToIncludedType("Restaurant")).toBe("restaurant");
    expect(mapCategoryToIncludedType("SALON")).toBe("hair_salon");
  });

  it("returns undefined for unknown categories instead of guessing", () => {
    expect(mapCategoryToIncludedType("something obscure")).toBeUndefined();
    expect(mapCategoryToIncludedType(undefined)).toBeUndefined();
  });
});
