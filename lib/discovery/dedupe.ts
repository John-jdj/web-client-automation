export interface BusinessMatchCandidate {
  googlePlaceId: string | null;
  normalizedBusinessName: string | null;
  phone: string | null;
  address: string | null;
}

/**
 * Pure predicate mirroring the matching rule `upsertBusiness()`
 * (lib/db/businesses.ts) applies against the database:
 *  1. Same `google_place_id` (primary — Google's own stable ID).
 *  2. Same `normalized_business_name` AND (same `phone` OR same `address`)
 *     (secondary fallback).
 * Kept here, side-effect free, so the matching rule itself is unit
 * testable without a database.
 */
export function isDuplicateBusinessMatch(
  existing: BusinessMatchCandidate,
  candidate: BusinessMatchCandidate
): boolean {
  if (existing.googlePlaceId && candidate.googlePlaceId) {
    return existing.googlePlaceId === candidate.googlePlaceId;
  }

  if (!existing.normalizedBusinessName || !candidate.normalizedBusinessName) {
    return false;
  }
  if (existing.normalizedBusinessName !== candidate.normalizedBusinessName) {
    return false;
  }

  const phoneMatches =
    Boolean(existing.phone) && Boolean(candidate.phone) && existing.phone === candidate.phone;
  const addressMatches =
    Boolean(existing.address) &&
    Boolean(candidate.address) &&
    existing.address === candidate.address;

  return phoneMatches || addressMatches;
}
