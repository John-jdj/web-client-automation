import type { GooglePlace } from "./types";

/**
 * Fictional demo-mode search results, used only when GOOGLE_MAPS_API_KEY is
 * not configured and DEMO_MODE is not explicitly disabled. Every mock place
 * ID is prefixed `demo_` so these can never collide with, or be confused
 * for, a real Google Place ID.
 */
export function buildMockPlaces(
  location: string,
  category: string,
  count: number
): GooglePlace[] {
  const templates: Array<{ name: string; hasWebsite: boolean; rating: number; reviews: number }> = [
    { name: "Sunrise", hasWebsite: true, rating: 4.5, reviews: 210 },
    { name: "Prime", hasWebsite: false, rating: 4.1, reviews: 45 },
    { name: "Blue Ocean", hasWebsite: false, rating: 3.8, reviews: 88 },
    { name: "Elite", hasWebsite: true, rating: 4.7, reviews: 320 },
    { name: "Wellness", hasWebsite: false, rating: 4.2, reviews: 62 },
    { name: "Golden", hasWebsite: false, rating: 3.9, reviews: 30 },
    { name: "Metro", hasWebsite: true, rating: 4.0, reviews: 150 },
    { name: "Heritage", hasWebsite: false, rating: 4.4, reviews: 97 },
  ];

  const label = category.trim() || "Business";

  return templates.slice(0, Math.max(0, Math.min(count, templates.length))).map((t, i) => ({
    id: `demo_${label.toLowerCase().replace(/\s+/g, "_")}_${location
      .toLowerCase()
      .replace(/\s+/g, "_")}_${i + 1}`,
    displayName: { text: `${t.name} ${label}`, languageCode: "en" },
    formattedAddress: `${10 + i} Demo Street, ${location}`,
    addressComponents: [
      { longText: location, shortText: location, types: ["locality"] },
    ],
    location: { latitude: 10.35 + i * 0.001, longitude: 77.95 + i * 0.001 },
    types: [label.toLowerCase()],
    primaryType: label.toLowerCase(),
    nationalPhoneNumber: `+91 90000 0${(1000 + i).toString().slice(-4)}`,
    websiteUri: t.hasWebsite
      ? `https://${t.name.toLowerCase().replace(/\s+/g, "")}-${label.toLowerCase()}-demo.example.com`
      : undefined,
    googleMapsUri: `https://maps.google.com/?q=demo_${i + 1}`,
    rating: t.rating,
    userRatingCount: t.reviews,
  }));
}
