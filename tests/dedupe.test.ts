import { describe, expect, it } from "vitest";
import { isDuplicateBusinessMatch } from "@/lib/discovery/dedupe";

describe("isDuplicateBusinessMatch (duplicate detection)", () => {
  it("matches on google_place_id alone", () => {
    const existing = {
      googlePlaceId: "place_1",
      normalizedBusinessName: "abc bakery",
      phone: "+919876543210",
      address: "12 Market Street",
    };
    const candidate = {
      googlePlaceId: "place_1",
      normalizedBusinessName: "a totally different name",
      phone: null,
      address: null,
    };

    expect(isDuplicateBusinessMatch(existing, candidate)).toBe(true);
  });

  it("does not match different place ids even with the same name", () => {
    const existing = {
      googlePlaceId: "place_1",
      normalizedBusinessName: "abc bakery",
      phone: "+919876543210",
      address: "12 Market Street",
    };
    const candidate = {
      googlePlaceId: "place_2",
      normalizedBusinessName: "abc bakery",
      phone: "+919876543210",
      address: "12 Market Street",
    };

    expect(isDuplicateBusinessMatch(existing, candidate)).toBe(false);
  });

  it("falls back to normalized name + phone when place ids are absent", () => {
    const existing = {
      googlePlaceId: null,
      normalizedBusinessName: "abc bakery",
      phone: "+919876543210",
      address: null,
    };
    const candidate = {
      googlePlaceId: null,
      normalizedBusinessName: "abc bakery",
      phone: "+919876543210",
      address: null,
    };

    expect(isDuplicateBusinessMatch(existing, candidate)).toBe(true);
  });

  it("falls back to normalized name + address when phone is absent", () => {
    const existing = {
      googlePlaceId: null,
      normalizedBusinessName: "abc bakery",
      phone: null,
      address: "12 Market Street",
    };
    const candidate = {
      googlePlaceId: null,
      normalizedBusinessName: "abc bakery",
      phone: null,
      address: "12 Market Street",
    };

    expect(isDuplicateBusinessMatch(existing, candidate)).toBe(true);
  });

  it("does not match when name matches but neither phone nor address do", () => {
    const existing = {
      googlePlaceId: null,
      normalizedBusinessName: "abc bakery",
      phone: "+919876543210",
      address: "12 Market Street",
    };
    const candidate = {
      googlePlaceId: null,
      normalizedBusinessName: "abc bakery",
      phone: "+911111111111",
      address: "99 Other Road",
    };

    expect(isDuplicateBusinessMatch(existing, candidate)).toBe(false);
  });

  it("does not match unrelated businesses", () => {
    const existing = {
      googlePlaceId: null,
      normalizedBusinessName: "abc bakery",
      phone: "+919876543210",
      address: "12 Market Street",
    };
    const candidate = {
      googlePlaceId: null,
      normalizedBusinessName: "royal salon",
      phone: "+911111111111",
      address: "99 Other Road",
    };

    expect(isDuplicateBusinessMatch(existing, candidate)).toBe(false);
  });
});
