/**
 * Shared, environment-agnostic constants (safe to import from client code,
 * e.g. the discovery form) — kept separate from lib/google/places.ts which
 * is server-only.
 */
export const DISCOVERY_LIMIT_OPTIONS = [10, 25, 50] as const;
export const MAX_DISCOVERY_LIMIT = 50;
