import { describe, expect, it } from "vitest";
import {
  isOfficialWebsite,
  mapGooglePlaceToBusiness,
  normalizeAddress,
  normalizeBusinessName,
  normalizePhone,
  normalizeWebsite,
} from "@/lib/google/normalize";
import type { GooglePlace } from "@/lib/google/types";

describe("normalizeBusinessName", () => {
  it("produces the same key regardless of case", () => {
    expect(normalizeBusinessName("ABC BAKERY")).toBe("abc bakery");
    expect(normalizeBusinessName("Abc Bakery")).toBe("abc bakery");
    expect(normalizeBusinessName("abc bakery")).toBe("abc bakery");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeBusinessName("ABC   Bakery\t")).toBe("abc bakery");
  });
});

describe("normalizePhone", () => {
  it("strips formatting but keeps a leading +", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
  });

  it("strips formatting for numbers without a country code", () => {
    expect(normalizePhone("(987) 654-3210")).toBe("9876543210");
  });

  it("returns null for empty/missing input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("normalizeWebsite", () => {
  it("lower-cases the hostname", () => {
    expect(normalizeWebsite("https://ABC-Bakery.EXAMPLE.com")).toBe(
      "https://abc-bakery.example.com"
    );
  });

  it("adds a scheme when missing", () => {
    expect(normalizeWebsite("example.com")).toBe("https://example.com");
  });

  it("returns null for empty/invalid input", () => {
    expect(normalizeWebsite(null)).toBeNull();
    expect(normalizeWebsite("")).toBeNull();
    expect(normalizeWebsite("not a url at all!!")).toBeNull();
  });
});

describe("normalizeAddress", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeAddress("  12   Market   Street ")).toBe("12 Market Street");
  });

  it("returns null for empty input", () => {
    expect(normalizeAddress(null)).toBeNull();
    expect(normalizeAddress("   ")).toBeNull();
  });
});

describe("isOfficialWebsite (website detection)", () => {
  it("treats a normal business domain as official", () => {
    expect(isOfficialWebsite("https://abcbakery.example.com")).toBe(true);
  });

  it("rejects known directory/social hosts", () => {
    expect(isOfficialWebsite("https://www.facebook.com/abcbakery")).toBe(false);
    expect(isOfficialWebsite("https://instagram.com/abcbakery")).toBe(false);
    expect(isOfficialWebsite("https://youtube.com/@abcbakery")).toBe(false);
    expect(isOfficialWebsite("https://www.justdial.com/Dindigul/abc-bakery")).toBe(false);
    expect(isOfficialWebsite("https://www.indiamart.com/abc-bakery")).toBe(false);
    expect(isOfficialWebsite("https://www.yelp.com/biz/abc-bakery")).toBe(false);
    expect(isOfficialWebsite("https://maps.google.com/?cid=123")).toBe(false);
  });

  it("rejects missing/empty urls", () => {
    expect(isOfficialWebsite(null)).toBe(false);
    expect(isOfficialWebsite(undefined)).toBe(false);
    expect(isOfficialWebsite("")).toBe(false);
  });
});

describe("mapGooglePlaceToBusiness (Google response normalization)", () => {
  const basePlace: GooglePlace = {
    id: "ChIJ_test_place_id",
    displayName: { text: "ABC Bakery", languageCode: "en" },
    formattedAddress: "12 Market Street, Dindigul, Tamil Nadu 624001, India",
    addressComponents: [
      { longText: "Dindigul", shortText: "Dindigul", types: ["locality"] },
      {
        longText: "Tamil Nadu",
        shortText: "TN",
        types: ["administrative_area_level_1"],
      },
      { longText: "India", shortText: "IN", types: ["country"] },
      { longText: "624001", shortText: "624001", types: ["postal_code"] },
    ],
    location: { latitude: 10.3673, longitude: 77.9803 },
    types: ["bakery", "food"],
    primaryType: "bakery",
    nationalPhoneNumber: "098765 43210",
    websiteUri: "https://abcbakery.example.com",
    googleMapsUri: "https://maps.google.com/?cid=123",
    rating: 4.3,
    userRatingCount: 87,
  };

  it("maps a full place with a real website", () => {
    const result = mapGooglePlaceToBusiness(basePlace);

    expect(result.googlePlaceId).toBe("ChIJ_test_place_id");
    expect(result.businessName).toBe("ABC Bakery");
    expect(result.category).toBe("bakery");
    expect(result.city).toBe("Dindigul");
    expect(result.state).toBe("Tamil Nadu");
    expect(result.country).toBe("India");
    expect(result.postalCode).toBe("624001");
    expect(result.latitude).toBe(10.3673);
    expect(result.longitude).toBe(77.9803);
    expect(result.phone).toBe("9876543210");
    expect(result.hasWebsite).toBe(true);
    expect(result.websiteUrl).toBe("https://abcbakery.example.com");
    expect(result.rating).toBe(4.3);
    expect(result.reviewCount).toBe(87);
    expect(result.googleMapsUrl).toBe("https://maps.google.com/?cid=123");
  });

  it("marks hasWebsite false and drops websiteUrl when there is none", () => {
    const { websiteUri, ...rest } = basePlace;
    void websiteUri;
    const result = mapGooglePlaceToBusiness(rest as GooglePlace);

    expect(result.hasWebsite).toBe(false);
    expect(result.websiteUrl).toBeNull();
  });

  it("marks hasWebsite false when the only link is a social/directory profile", () => {
    const result = mapGooglePlaceToBusiness({
      ...basePlace,
      websiteUri: "https://www.facebook.com/abcbakery",
    });

    expect(result.hasWebsite).toBe(false);
    expect(result.websiteUrl).toBeNull();
  });

  it("does not invent missing fields — uses null", () => {
    const minimalPlace: GooglePlace = {
      id: "ChIJ_minimal",
      displayName: { text: "Minimal Business" },
    };

    const result = mapGooglePlaceToBusiness(minimalPlace);

    expect(result.category).toBeNull();
    expect(result.address).toBeNull();
    expect(result.city).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.rating).toBeNull();
    expect(result.reviewCount).toBeNull();
    expect(result.hasWebsite).toBe(false);
  });
});
