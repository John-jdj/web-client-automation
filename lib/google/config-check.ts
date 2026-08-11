import "server-only";

export interface GoogleApiConfigStatus {
  configured: boolean;
  exposedToClient: boolean;
}

/**
 * Safe, secret-free configuration check for the Google Places integration.
 * Never reads or returns the key value itself, and never calls the Google
 * API — this only inspects which environment variables are present.
 *
 *  - `configured`: is the server-only GOOGLE_MAPS_API_KEY set?
 *  - `exposedToClient`: has a NEXT_PUBLIC_-prefixed variant been set by
 *    mistake? Our code never reads such a variable, but Next.js inlines
 *    any NEXT_PUBLIC_* var into the client bundle at build time, so its
 *    mere presence is itself the leak — flag it if found.
 */
export function checkGoogleApiConfig(): GoogleApiConfigStatus {
  return {
    configured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    exposedToClient: Boolean(
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
        process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY
    ),
  };
}
