import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Temporary diagnostic route for verifying the database foundation during
 * setup. Disabled outside development so it can't be hit in production.
 * Never returns secrets — only booleans/counts/timestamps.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasPublishableKey = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
  const hasSecretKey = Boolean(process.env.SUPABASE_SECRET_KEY);

  if (!hasUrl || !hasPublishableKey || !hasSecretKey) {
    return NextResponse.json(
      {
        ok: false,
        stage: "env",
        env: { hasUrl, hasPublishableKey, hasSecretKey },
        message:
          "One or more required Supabase environment variables are missing. See .env.example.",
      },
      { status: 503 }
    );
  }

  try {
    const supabase = createServiceClient();
    const { count, error } = await supabase
      .from("businesses")
      .select("*", { count: "exact", head: true });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          stage: "query",
          env: { hasUrl, hasPublishableKey, hasSecretKey },
          message: error.message,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      stage: "connected",
      env: { hasUrl, hasPublishableKey, hasSecretKey },
      businessCount: count ?? 0,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        stage: "connection",
        env: { hasUrl, hasPublishableKey, hasSecretKey },
        message: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
