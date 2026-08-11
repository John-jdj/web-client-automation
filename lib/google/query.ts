/**
 * Pure, environment-agnostic query-building helpers — no network, no
 * "server-only" import, safe to unit test directly.
 */

const CATEGORY_TYPE_MAP: Record<string, string> = {
  restaurant: "restaurant",
  restaurants: "restaurant",
  cafe: "cafe",
  bakery: "bakery",
  gym: "gym",
  fitness: "gym",
  salon: "hair_salon",
  "hair salon": "hair_salon",
  "beauty salon": "beauty_salon",
  spa: "spa",
  clinic: "doctor",
  hospital: "hospital",
  dentist: "dentist",
  hotel: "hotel",
  pharmacy: "pharmacy",
  "real estate": "real_estate_agency",
  lawyer: "lawyer",
  "law firm": "lawyer",
};

function sanitizeInput(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export interface BuildTextQueryParams {
  query?: string;
  location?: string;
  category?: string;
}

/**
 * Builds a safe Places API `textQuery` string. Never blindly concatenates
 * unsanitized input — every part is trimmed, whitespace-collapsed, and
 * length-capped first.
 */
export function buildTextQuery({ query, location, category }: BuildTextQueryParams): string {
  if (query && query.trim()) {
    return sanitizeInput(query);
  }

  const cleanCategory = category ? sanitizeInput(category) : "";
  const cleanLocation = location ? sanitizeInput(location) : "";

  if (cleanCategory && cleanLocation) {
    return `${cleanCategory} in ${cleanLocation}`;
  }
  if (cleanCategory) return cleanCategory;
  if (cleanLocation) return cleanLocation;
  return "";
}

export function mapCategoryToIncludedType(category?: string): string | undefined {
  if (!category) return undefined;
  return CATEGORY_TYPE_MAP[category.trim().toLowerCase()];
}
