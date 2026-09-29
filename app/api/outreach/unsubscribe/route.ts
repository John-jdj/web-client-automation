import { NextResponse } from "next/server";
import { z } from "zod";
import { UnsubscribeRequestSchema } from "@/lib/validation/schemas";
import { addSuppression } from "@/lib/db/suppression";

/**
 * Deliberately the one unauthenticated endpoint in the outreach system —
 * it exists so a recipient can opt out of further contact without a
 * Supabase session, which real compliance (CAN-SPAM/GDPR) requires. It
 * can only ADD an address to the suppression list (never read, never
 * remove); every outreach eligibility check (generation and send) already
 * consults that list, so this is the single choke point that stops all
 * future contact. Idempotent — calling it twice for the same address is
 * a no-op, and the response never reveals whether the address existed in
 * the CRM beforehand.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const parsed = UnsubscribeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request.", details: z.treeifyError(parsed.error) },
      { status: 400 }
    );
  }

  try {
    await addSuppression({
      email: parsed.data.email,
      reason: "Recipient unsubscribed.",
      source: "outreach_unsubscribe",
    });
  } catch (err) {
    console.error("Unsubscribe failed:", err);
    return NextResponse.json(
      { success: false, error: "Could not process the unsubscribe request." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, message: "You have been unsubscribed." });
}
