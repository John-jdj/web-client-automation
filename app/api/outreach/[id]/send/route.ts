import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendOutreach, SendOutreachIneligibleError } from "@/lib/outreach/send-outreach";
import { EmailProviderError } from "@/lib/email/errors";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = await sendOutreach(id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof SendOutreachIneligibleError) {
      const status =
        err.code === "MESSAGE_NOT_FOUND" || err.code === "LEAD_NOT_FOUND" || err.code === "BUSINESS_NOT_FOUND"
          ? 404
          : 400;
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
    }
    if (err instanceof EmailProviderError) {
      const status =
        err.code === "MISSING_CREDENTIALS" || err.code === "AUTH_FAILED" || err.code === "ACCESS_DENIED"
          ? 502
          : err.code === "QUOTA_EXCEEDED"
            ? 429
            : 500;
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
    }

    console.error("Outreach send failed:", err);
    return NextResponse.json(
      { success: false, error: "Outreach send failed unexpectedly." },
      { status: 500 }
    );
  }
}
