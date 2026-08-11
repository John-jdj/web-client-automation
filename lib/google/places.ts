import "server-only";
import { DiscoveryError, classifyGoogleApiError } from "./errors";
import { buildMockPlaces } from "./mock-data";
import type { GooglePlace, GooglePlacesSearchResponse } from "./types";
import { DISCOVERY_LIMIT_OPTIONS, MAX_DISCOVERY_LIMIT } from "./constants";
import { buildTextQuery, mapCategoryToIncludedType } from "./query";

export { DISCOVERY_LIMIT_OPTIONS, MAX_DISCOVERY_LIMIT };
export { buildTextQuery, mapCategoryToIncludedType };

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

/**
 * Only the fields this application actually uses. Avoid `*` — some Places
 * fields (e.g. addressComponents) are billed at a higher SKU, so keep this
 * list intentional rather than requesting everything available.
 */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
  "nextPageToken",
].join(",");

const GOOGLE_PAGE_SIZE = 20;
const MAX_PAGES_PER_REQUEST = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS_PER_PAGE = 2;
const RETRY_DELAY_MS = 500;

function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE !== "false";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface GoogleApiErrorBody {
  error?: { status?: string; message?: string };
}

async function fetchPlacesPage(
  body: Record<string, unknown>,
  attempt = 1
): Promise<GooglePlacesSearchResponse> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new DiscoveryError(
      "MISSING_API_KEY",
      "Google Places API key is missing.",
      500,
      false
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorBody: GoogleApiErrorBody = {};
      try {
        errorBody = await response.json();
      } catch {
        // Non-JSON error body — fall through with empty details.
      }

      const classified = classifyGoogleApiError(
        response.status,
        errorBody.error?.status,
        errorBody.error?.message
      );

      if (classified.retryable && attempt < MAX_ATTEMPTS_PER_PAGE) {
        await delay(RETRY_DELAY_MS);
        return fetchPlacesPage(body, attempt + 1);
      }
      throw classified;
    }

    return (await response.json()) as GooglePlacesSearchResponse;
  } catch (err) {
    if (err instanceof DiscoveryError) throw err;

    if (err instanceof Error && err.name === "AbortError") {
      if (attempt < MAX_ATTEMPTS_PER_PAGE) {
        await delay(RETRY_DELAY_MS);
        return fetchPlacesPage(body, attempt + 1);
      }
      throw new DiscoveryError(
        "TIMEOUT",
        "Google Places API request timed out.",
        504,
        false
      );
    }

    if (attempt < MAX_ATTEMPTS_PER_PAGE) {
      await delay(RETRY_DELAY_MS);
      return fetchPlacesPage(body, attempt + 1);
    }
    throw new DiscoveryError(
      "UPSTREAM_UNAVAILABLE",
      "Google Places API is temporarily unavailable.",
      502,
      true
    );
  } finally {
    clearTimeout(timeout);
  }
}

export interface SearchBusinessesParams {
  query?: string;
  location?: string;
  category?: string;
  limit?: number;
}

export interface SearchBusinessesResult {
  places: GooglePlace[];
  requestCount: number;
  usedMock: boolean;
}

/**
 * Searches Google Places API (New) Text Search for businesses matching the
 * given query/location/category, paginating (bounded) until `limit` results
 * are collected or Google runs out of pages.
 *
 * Falls back to fictional mock results only when GOOGLE_MAPS_API_KEY is not
 * configured and DEMO_MODE has not been explicitly disabled — real
 * credentials always take priority.
 */
export async function searchBusinesses(
  params: SearchBusinessesParams
): Promise<SearchBusinessesResult> {
  const limit = Math.max(1, Math.min(params.limit ?? 10, MAX_DISCOVERY_LIMIT));
  const textQuery = buildTextQuery(params);

  if (!textQuery) {
    throw new DiscoveryError(
      "INVALID_REQUEST",
      "A location or category is required to search for businesses.",
      400,
      false
    );
  }

  if (!isGoogleConfigured()) {
    if (isDemoModeEnabled()) {
      return {
        places: buildMockPlaces(params.location ?? "your area", params.category ?? "business", limit),
        requestCount: 0,
        usedMock: true,
      };
    }
    throw new DiscoveryError(
      "MISSING_API_KEY",
      "Google Places API key is missing.",
      500,
      false
    );
  }

  const includedType = mapCategoryToIncludedType(params.category);
  const places: GooglePlace[] = [];
  let pageToken: string | undefined;
  let requestCount = 0;

  do {
    const body: Record<string, unknown> = {
      textQuery,
      pageSize: Math.min(GOOGLE_PAGE_SIZE, limit - places.length),
      ...(includedType ? { includedType } : {}),
      ...(pageToken ? { pageToken } : {}),
    };

    const page = await fetchPlacesPage(body);
    requestCount += 1;
    places.push(...(page.places ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && places.length < limit && requestCount < MAX_PAGES_PER_REQUEST);

  return { places: places.slice(0, limit), requestCount, usedMock: false };
}
