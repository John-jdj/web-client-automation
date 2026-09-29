/**
 * Centralized email provider configuration. Mirrors lib/vercel/config.ts's
 * shape exactly.
 */
export function isEmailProviderConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * DEMO_MODE is checked before credential presence — same rationale as
 * every other provider boundary in this app (Claude, Vercel): it's the
 * explicit dev-mode override, so no real email is ever sent, and no
 * RESEND_API_KEY is required, unless DEMO_MODE is deliberately set to
 * "false".
 */
export function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE !== "false";
}

export function getResendApiKey(): string | undefined {
  return process.env.RESEND_API_KEY;
}

export function getEmailFrom(): string | undefined {
  return process.env.EMAIL_FROM;
}

export function getEmailReplyTo(): string | undefined {
  return process.env.EMAIL_REPLY_TO;
}

export const RESEND_API_BASE = "https://api.resend.com";
export const EMAIL_PROVIDER = "email";
