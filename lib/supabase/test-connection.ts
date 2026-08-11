export type SupabaseConnectionTestResult =
  | { status: "not_configured"; message: string }
  | { status: "connected"; message: string }
  | { status: "error"; message: string };

/**
 * Server-side check that the configured Supabase project is reachable.
 * Hits Supabase Auth's public `/auth/v1/health` endpoint, which requires
 * only a valid API key (no database schema or session needed) — a real
 * network round-trip, not a hardcoded success.
 */
export async function testSupabaseConnection(): Promise<SupabaseConnectionTestResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      status: "not_configured",
      message:
        "NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set. Add them to .env.local (see .env.example).",
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseKey },
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        status: "error",
        message: `Supabase responded with HTTP ${response.status} ${response.statusText}.`,
      };
    }

    return {
      status: "connected",
      message: "Successfully reached the Supabase project.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? `Failed to reach Supabase: ${error.message}`
          : "Failed to reach Supabase due to an unknown error.",
    };
  }
}
