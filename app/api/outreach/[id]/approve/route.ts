import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { approveOutreach, ReviewOutreachIneligibleError } from "@/lib/outreach/review-outreach";

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
    const message = await approveOutreach(id);
    return NextResponse.json({ success: true, messageId: message.id, status: message.status });
  } catch (err) {
    if (err instanceof ReviewOutreachIneligibleError) {
      const status = err.code === "MESSAGE_NOT_FOUND" || err.code === "LEAD_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
    }
    console.error("Outreach approval failed:", err);
    return NextResponse.json(
      { success: false, error: "Outreach approval failed unexpectedly." },
      { status: 500 }
    );
  }
}
