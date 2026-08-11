import { NextResponse } from "next/server";
import { checkGoogleApiConfig } from "@/lib/google/config-check";

/**
 * Temporary diagnostic route for verifying the Google Places API key
 * configuration during setup. Disabled outside development. Makes no
 * Google API calls and never returns the key itself — only booleans.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { configured, exposedToClient } = checkGoogleApiConfig();

  return NextResponse.json({
    apiKeyConfigured: configured ? "YES" : "NO",
    apiKeyExposedToClient: exposedToClient ? "YES" : "NO",
  });
}
