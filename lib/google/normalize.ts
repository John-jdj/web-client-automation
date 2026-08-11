import type {
  GooglePlace,
  GooglePlaceAddressComponent,
  NormalizedBusiness,
} from "./types";

/**
 * Hostnames that Google Places sometimes returns as `websiteUri` but that
 * are never an official business website — directory listings, social
 * profiles, and Google's own properties. Matched by suffix so subdomains
 * (e.g. `m.facebook.com`) are also caught.
 */
const NON_OFFICIAL_WEBSITE_HOSTS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "justdial.com",
  "indiamart.com",
  "yelp.com",
  "google.com",
  "goo.gl",
  "maps.app.goo.gl",
];

/** Collapses internal whitespace and trims. Never returns null for a non-empty input. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Produces a case- and whitespace-insensitive key for deduplication.
 * The original `business_name` from Google is never altered — this is
 * only stored in `normalized_business_name`.
 */
export function normalizeBusinessName(name: string): string {
  return collapseWhitespace(name).toLowerCase();
}

/**
 * Keeps a leading `+` (international prefix) and digits only. Returns null
 * for empty/unusable input rather than inventing a value.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Lower-cases the host, strips a trailing slash, and ensures a scheme.
 * Returns null for empty/unusable input.
 */
export function normalizeWebsite(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    parsed.hostname = parsed.hostname.toLowerCase();
    let result = parsed.toString();
    if (result.endsWith("/") && parsed.pathname === "/") {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return null;
  }
}

export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const collapsed = collapseWhitespace(address);
  return collapsed || null;
}

/**
 * Website-presence rule: `websiteUri` from Google Places is the sole
 * signal. A URL is only treated as "no website" if it's missing or points
 * at a known directory/social host — we do not scrape or guess.
 */
export function isOfficialWebsite(url: string | null | undefined): boolean {
  const normalized = normalizeWebsite(url);
  if (!normalized) return false;

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return !NON_OFFICIAL_WEBSITE_HOSTS.some(
      (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`)
    );
  } catch {
    return false;
  }
}

function findAddressComponent(
  components: GooglePlaceAddressComponent[] | undefined,
  type: string
): string | null {
  if (!components) return null;
  const match = components.find((component) => component.types?.includes(type));
  return match?.longText?.trim() || match?.shortText?.trim() || null;
}

/**
 * Maps a single Places API (New) result to our normalized business shape.
 * Pure and side-effect free — does not touch the database or network.
 * Never invents values: missing Google fields become `null`.
 */
export function mapGooglePlaceToBusiness(place: GooglePlace): NormalizedBusiness {
  const rawWebsite = place.websiteUri ?? null;
  const hasWebsite = isOfficialWebsite(rawWebsite);

  return {
    googlePlaceId: place.id,
    businessName: place.displayName?.text?.trim() || "",
    category: place.primaryType ?? place.types?.[0] ?? null,
    address: normalizeAddress(place.formattedAddress),
    city:
      findAddressComponent(place.addressComponents, "locality") ??
      findAddressComponent(place.addressComponents, "sublocality"),
    state: findAddressComponent(place.addressComponents, "administrative_area_level_1"),
    country: findAddressComponent(place.addressComponents, "country"),
    postalCode: findAddressComponent(place.addressComponents, "postal_code"),
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
    phone: normalizePhone(place.nationalPhoneNumber ?? place.internationalPhoneNumber),
    // Only kept when it passes the official-website check; otherwise we
    // record that Google returned a non-official link by leaving this
    // null while `hasWebsite` reflects the same decision.
    websiteUrl: hasWebsite ? normalizeWebsite(rawWebsite) : null,
    hasWebsite,
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    googleMapsUrl: place.googleMapsUri ?? null,
    openingHours: place.regularOpeningHours ?? null,
    rawData: place,
  };
}
