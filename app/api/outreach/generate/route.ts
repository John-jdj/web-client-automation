import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { GenerateOutreachRequestSchema } from "@/lib/validation/schemas";
import { generateOutreach, GenerateOutreachIneligibleError } from "@/lib/outreach/generate-outreach";
import { AnalysisError } from "@/lib/ai/errors";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
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

  const parsed = GenerateOutreachRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request.", details: z.treeifyError(parsed.error) },
      { status: 400 }
    );
  }

  try {
    const result = await generateOutreach(parsed.data.leadId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof GenerateOutreachIneligibleError) {
      const status = err.code === "LEAD_NOT_FOUND" || err.code === "BUSINESS_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
    }
    if (err instanceof AnalysisError) {
      const status =
        err.code === "MISSING_API_KEY" || err.code === "AUTH_FAILED" || err.code === "ACCESS_DENIED"
          ? 502
          : err.code === "QUOTA_EXCEEDED"
            ? 429
            : 500;
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
    }

    console.error("Outreach generation failed:", err);
    return NextResponse.json(
      { success: false, error: "Outreach generation failed unexpectedly." },
      { status: 500 }
    );
  }
}
