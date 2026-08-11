import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { runDiscovery } from "@/lib/discovery/run";
import { DiscoveryRequestSchema } from "@/lib/validation/schemas";
import { DiscoveryError } from "@/lib/google/errors";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const parsed = DiscoveryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid request.",
        details: z.treeifyError(parsed.error),
      },
      { status: 400 }
    );
  }

  try {
    const result = await runDiscovery(parsed.data);
    return NextResponse.json({
      success: true,
      summary: result.summary,
      businesses: result.businesses,
      usedMock: result.usedMock,
    });
  } catch (err) {
    if (err instanceof DiscoveryError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.httpStatus }
      );
    }

    // Supabase/Postgres errors and anything else unexpected — never echo
    // the raw error (may contain connection details) to the client.
    console.error("Discovery run failed:", err);
    return NextResponse.json(
      { success: false, error: "Discovery run failed unexpectedly." },
      { status: 500 }
    );
  }
}
