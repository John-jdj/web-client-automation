import { NextResponse } from "next/server";
import { UnsubscribeRequestSchema } from "@/lib/validation/schemas";
import { verifyUnsubscribeToken } from "@/lib/outreach/unsubscribe-token";
import { getOutreachMessageAsService } from "@/lib/db/outreach";
import { addSuppressionAsService } from "@/lib/db/suppression";

/**
 * Deliberately the one unauthenticated endpoint in the outreach system —
 * a recipient clicking an unsubscribe link has no Supabase session, which
 * real compliance (CAN-SPAM/GDPR) requires supporting. What replaces
 * authentication here is the HMAC-signed, expiring token
 * (lib/outreach/unsubscribe-token.ts): the caller can never choose an
 * arbitrary email, only whatever address the token was actually signed
 * for when the message was sent. This endpoint can only ADD to
 * suppression_list (never read it back, never remove from it); every
 * outreach eligibility check already consults that list, so this is the
 * single choke point that stops all future contact for that address.
 * Idempotent, and the response never reveals whether the address was
 * already suppressed.
 */
async function processUnsubscribeToken(rawToken: unknown): Promise<boolean> {
  const parsed = UnsubscribeRequestSchema.safeParse({ token: rawToken });
  if (!parsed.success) return false;

  const verified = verifyUnsubscribeToken(parsed.data.token);
  if (!verified) return false;

  const message = await getOutreachMessageAsService(verified.messageId);
  if (!message?.recipient_email) return false;

  await addSuppressionAsService({
    email: message.recipient_email,
    reason: "Recipient unsubscribed.",
    source: "outreach_unsubscribe",
  });
  return true;
}

function confirmationPage(): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head>` +
      `<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #18181b;">` +
      `<h1>You've been unsubscribed</h1>` +
      `<p>You will not receive any further outreach emails from us. If this was a mistake, no action is needed — we will not add you back automatically.</p>` +
      `</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function invalidLinkPage(): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Link expired</title></head>` +
      `<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #18181b;">` +
      `<h1>This link is invalid or has expired</h1>` +
      `<p>Please contact us directly if you'd like to stop receiving emails.</p>` +
      `</body></html>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

/** Clicked from an email — recipients navigate here directly. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");

  try {
    const ok = await processUnsubscribeToken(token);
    return ok ? confirmationPage() : invalidLinkPage();
  } catch (err) {
    console.error("Unsubscribe (GET) failed:", err);
    return invalidLinkPage();
  }
}

/** Programmatic equivalent (e.g. a "manage preferences" UI or a test harness). */
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

  try {
    const ok = await processUnsubscribeToken((body as { token?: unknown } | null)?.token);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "This link is invalid or has expired." },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, message: "You have been unsubscribed." });
  } catch (err) {
    console.error("Unsubscribe (POST) failed:", err);
    return NextResponse.json(
      { success: false, error: "Could not process the unsubscribe request." },
      { status: 500 }
    );
  }
}
