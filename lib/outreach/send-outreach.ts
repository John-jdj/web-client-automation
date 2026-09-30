import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getLead } from "@/lib/db/leads";
import { getBusiness } from "@/lib/db/businesses";
import { isSuppressed } from "@/lib/db/suppression";
import { getAutomationSettings, countTodaysOutreachSends } from "@/lib/db/automation-settings";
import { getOutreachMessage, updateOutreachMessage, type OutreachMessage } from "@/lib/db/outreach";
import { sendEmail } from "@/lib/email/send-email";
import { renderOutreachEmailHtml, renderOutreachEmailText } from "@/lib/outreach/render-email";
import { buildUnsubscribeUrl } from "@/lib/outreach/unsubscribe-token";
import { EmailProviderError } from "@/lib/email/errors";
import { EMAIL_PROVIDER } from "@/lib/email/config";

const MAX_ATTEMPTS = 2;

export type SendOutreachIneligibleCode =
  | "MESSAGE_NOT_FOUND"
  | "LEAD_NOT_FOUND"
  | "BUSINESS_NOT_FOUND"
  | "NOT_APPROVED"
  | "AUTO_OUTREACH_DISABLED"
  | "SUPPRESSED"
  | "MISSING_EMAIL"
  | "DUPLICATE_ACTIVE_OUTREACH"
  | "DAILY_LIMIT_REACHED";

export class SendOutreachIneligibleError extends Error {
  code: SendOutreachIneligibleCode;
  constructor(code: SendOutreachIneligibleCode, message: string) {
    super(message);
    this.name = "SendOutreachIneligibleError";
    this.code = code;
  }
}

export interface SendOutreachResult {
  messageId: string;
  status: OutreachMessage["status"];
  providerMessageId: string | null;
  usedMock: boolean;
}

/**
 * Step 10's send stage — the ONLY place an email is ever actually sent
 * anywhere in this app (no automatic trigger calls this; it is only
 * reachable via the authenticated POST /api/outreach/[id]/send route).
 * Every check below is re-verified at send time, not just trusted from
 * generation/approval time, since state (suppression, daily usage,
 * another message for the same lead) can change in between:
 *
 *  1. message + lead + business exist and are visible to the caller (RLS)
 *  2. message is QUEUED ("approved" — see review-outreach.ts) — or DRAFT
 *     if automation_settings.require_outreach_approval has been
 *     explicitly turned off
 *  3. automation_settings.auto_outreach_enabled is true — this is the
 *     account-level "outreach is live" switch; false by default, so even
 *     an approved message cannot be sent until an admin opts in
 *  4. recipient is not on the suppression list
 *  5. no duplicate SENT/SENDING message already exists for this lead
 *  6. daily_outreach_limit has not been reached today
 *
 * Only after all six hold does it call the DEMO_MODE/real email adapter.
 */
export async function sendOutreach(messageId: string): Promise<SendOutreachResult> {
  const message = await getOutreachMessage(messageId);
  if (!message) {
    throw new SendOutreachIneligibleError("MESSAGE_NOT_FOUND", "Outreach message not found.");
  }
  const lead = await getLead(message.lead_id);
  if (!lead) {
    throw new SendOutreachIneligibleError("LEAD_NOT_FOUND", "Lead not found for this outreach message.");
  }
  const business = await getBusiness(lead.business_id);
  if (!business) {
    throw new SendOutreachIneligibleError("BUSINESS_NOT_FOUND", "Business not found for this outreach message.");
  }

  const settings = await getAutomationSettings();

  const approved = message.status === "QUEUED";
  const draftSendAllowed = message.status === "DRAFT" && !settings.require_outreach_approval;
  if (!approved && !draftSendAllowed) {
    throw new SendOutreachIneligibleError(
      "NOT_APPROVED",
      `This message is not approved for sending (status: ${message.status}).`
    );
  }

  if (!settings.auto_outreach_enabled) {
    throw new SendOutreachIneligibleError(
      "AUTO_OUTREACH_DISABLED",
      "Outreach sending is disabled in automation_settings (auto_outreach_enabled=false)."
    );
  }

  if (!message.recipient_email) {
    throw new SendOutreachIneligibleError("MISSING_EMAIL", "This message has no recipient email.");
  }

  const suppressed = await isSuppressed({ phone: business.phone, email: message.recipient_email });
  if (suppressed) {
    await updateOutreachMessage(message.id, {
      status: "CANCELLED",
      error_message: "Recipient is on the suppression list.",
    });
    throw new SendOutreachIneligibleError("SUPPRESSED", "This recipient is on the suppression list.");
  }

  const duplicateSent = await hasAnotherSentOrSendingMessage(message);
  if (duplicateSent) {
    throw new SendOutreachIneligibleError(
      "DUPLICATE_ACTIVE_OUTREACH",
      "Another message to this lead has already been sent or is sending."
    );
  }

  const usedToday = await countTodaysOutreachSends();
  if (usedToday >= settings.daily_outreach_limit) {
    throw new SendOutreachIneligibleError(
      "DAILY_LIMIT_REACHED",
      `Daily outreach limit reached (${settings.daily_outreach_limit}/day).`
    );
  }

  await updateOutreachMessage(message.id, { status: "SENDING" });

  // Built before the retry loop, and its own failure (only possible in
  // real mode with OUTREACH_UNSUBSCRIBE_SECRET/APP_URL missing) is never
  // retried — it's a configuration problem, not a transient provider
  // error, so it goes straight to FAILED without ever calling sendEmail.
  let unsubscribeUrl: string;
  try {
    unsubscribeUrl = buildUnsubscribeUrl(message.id);
  } catch (err) {
    await persistSendFailure(message, err, 1);
    throw err instanceof EmailProviderError
      ? err
      : new EmailProviderError("UNKNOWN", "Could not build a safe unsubscribe link.", false);
  }

  const html = renderOutreachEmailHtml(message.message_body ?? "", unsubscribeUrl);
  const text = renderOutreachEmailText(message.message_body ?? "", unsubscribeUrl);
  const subject = message.subject ?? "";

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await sendEmail({ to: message.recipient_email, subject, html, text });

      const updated = await updateOutreachMessage(message.id, {
        status: "SENT",
        sent_at: new Date().toISOString(),
        provider_message_id: result.providerMessageId,
        attempt_count: message.attempt_count + attempt,
      });

      await logOutreachEvent(message.id, "SENT", { usedMock: result.usedMock });
      await logOutreachUsage();

      return {
        messageId: updated.id,
        status: updated.status,
        providerMessageId: updated.provider_message_id,
        usedMock: result.usedMock,
      };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof EmailProviderError ? err.retryable : false;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
    }
  }

  await persistSendFailure(message, lastError, MAX_ATTEMPTS);

  const errorMessage =
    lastError instanceof EmailProviderError
      ? lastError.message
      : lastError instanceof Error
        ? lastError.message
        : "Outreach send failed.";

  throw lastError instanceof EmailProviderError
    ? lastError
    : new EmailProviderError("UNKNOWN", errorMessage, false);
}

/** Records a FAILED outreach_messages row + event + error log — shared by the retry loop and the pre-send unsubscribe-link failure path. */
async function persistSendFailure(
  message: OutreachMessage,
  err: unknown,
  attemptsMade = 1
): Promise<void> {
  const errorMessage =
    err instanceof EmailProviderError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Outreach send failed.";

  await updateOutreachMessage(message.id, {
    status: "FAILED",
    error_message: errorMessage,
    attempt_count: message.attempt_count + attemptsMade,
  });
  await logOutreachEvent(message.id, "FAILED", null);
  await logSendError(message.lead_id, errorMessage);
}

/** True if some OTHER message for the same lead is already SENT or SENDING. */
async function hasAnotherSentOrSendingMessage(message: OutreachMessage): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("id")
    .eq("lead_id", message.lead_id)
    .in("status", ["SENT", "SENDING"])
    .neq("id", message.id)
    .limit(1);

  if (error) throw error;
  return Boolean(data && data.length > 0);
}

async function logOutreachEvent(
  messageId: string,
  eventType: "SENT" | "FAILED",
  metadata: { usedMock: boolean } | null
) {
  const supabase = await createClient();
  await supabase.from("outreach_events").insert({
    message_id: messageId,
    event_type: eventType,
    metadata: metadata ? { usedMock: metadata.usedMock } : null,
  });
}

async function logOutreachUsage() {
  const supabase = await createClient();
  await supabase.from("api_usage").insert({
    provider: EMAIL_PROVIDER,
    operation: "outreach_send",
    quantity: 1,
  });
}

async function logSendError(leadId: string, message: string) {
  const supabase = await createClient();
  await supabase.from("error_logs").insert({
    service: "outreach_send",
    message,
    lead_id: leadId,
  });
}
