import "server-only";
import {
  isDemoModeEnabled,
  isEmailProviderConfigured,
  getResendApiKey,
  getEmailFrom,
  getEmailReplyTo,
  RESEND_API_BASE,
} from "./config";
import { EmailProviderError, classifyEmailProviderStatus, classifyEmailNetworkError } from "./errors";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  usedMock: boolean;
  providerMessageId: string;
  simulated: boolean;
}

/**
 * Deterministic DEMO_MODE stand-in — never sends anything, never touches
 * the network. `providerMessageId` is derived only from `to`+`subject`,
 * so it's stable across repeat calls for the same input (useful for
 * assertions in tests, matching lib/vercel/deploy-adapter.ts's mock).
 */
function sendMock(input: SendEmailInput): SendEmailResult {
  const key = `${input.to}:${input.subject}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    usedMock: true,
    simulated: true,
    providerMessageId: `mock_email_${key}`,
  };
}

/**
 * Real send via the Resend REST API (https://resend.com/docs/api-reference/emails/send-email).
 * Plain `fetch` — no SDK dependency, same choice as lib/vercel/deploy-adapter.ts.
 */
async function sendReal(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = getResendApiKey();
  const from = getEmailFrom();
  if (!apiKey || !from) {
    throw new EmailProviderError("MISSING_CREDENTIALS", "Email provider credentials are missing.", false);
  }
  const replyTo = getEmailReplyTo();

  let response: Response;
  try {
    response = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch (err) {
    throw classifyEmailNetworkError(err);
  }

  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    // classifyEmailProviderStatus only logs status + requestId — never the
    // response body or request headers (which carry the Authorization
    // bearer token).
    throw classifyEmailProviderStatus(response.status, requestId);
  }

  const data = (await response.json()) as { id?: string };
  if (!data.id) {
    throw new EmailProviderError("UNKNOWN", "Email provider response was missing an id.", false);
  }

  return { usedMock: false, simulated: false, providerMessageId: data.id };
}

/**
 * Single entry point used by lib/outreach/send-outreach.ts. DEMO_MODE is
 * checked first (same rule as every other provider boundary in this app):
 * while DEMO_MODE=true, no email is ever sent and no credentials are
 * required — set DEMO_MODE=false deliberately to use the real provider.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (isDemoModeEnabled()) {
    return sendMock(input);
  }
  if (!isEmailProviderConfigured()) {
    throw new EmailProviderError("MISSING_CREDENTIALS", "Email provider credentials are missing.", false);
  }
  return sendReal(input);
}
