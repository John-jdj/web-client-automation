import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { EmailProviderError } from "@/lib/email/errors";

const DEFAULT_TTL_DAYS = 30;

/**
 * Deterministic, non-secret fallback — used ONLY while DEMO_MODE is
 * enabled, so unsubscribe tokens can be signed/verified in tests and
 * local dev without any env setup. `resolveSecret()` below never returns
 * this once DEMO_MODE=false; a real send with no real secret configured
 * fails instead (see buildUnsubscribeUrl).
 */
const DEMO_MODE_FALLBACK_SECRET = "demo-mode-unsubscribe-secret-not-for-production";

function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE !== "false";
}

function resolveSecret(): string {
  const configured = process.env.OUTREACH_UNSUBSCRIBE_SECRET;
  if (configured) return configured;
  if (isDemoModeEnabled()) return DEMO_MODE_FALLBACK_SECRET;
  throw new EmailProviderError(
    "MISSING_CREDENTIALS",
    "Outreach email cannot be sent: OUTREACH_UNSUBSCRIBE_SECRET is not configured.",
    false
  );
}

function ttlSeconds(): number {
  const configured = Number(process.env.OUTREACH_UNSUBSCRIBE_TOKEN_TTL_DAYS);
  const days = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_DAYS;
  return days * 24 * 60 * 60;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

interface UnsubscribeTokenPayload {
  /** outreach_messages.id — the token identifies a message, never a raw email address. */
  mid: string;
  /** Unix seconds. */
  exp: number;
}

/**
 * Signs a tamper-resistant, expiring token for one outreach message.
 * Throws (via resolveSecret) only when DEMO_MODE=false and no real
 * secret is configured — callers (lib/outreach/send-outreach.ts) let
 * that propagate so a real send fails before ever reaching the email
 * provider, rather than going out with a broken/insecure unsubscribe link.
 */
export function signUnsubscribeToken(messageId: string): string {
  const secret = resolveSecret();
  const payload: UnsubscribeTokenPayload = {
    mid: messageId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

/**
 * Verifies a token's signature and expiry. Never throws on bad input —
 * every failure mode (malformed, tampered, expired, or no secret
 * resolvable at all) returns null, so callers always get the same
 * generic "invalid/expired" outcome regardless of which check failed.
 */
export function verifyUnsubscribeToken(token: unknown): { messageId: string } | null {
  if (typeof token !== "string" || token.length === 0) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return null;

  let secret: string;
  try {
    secret = resolveSecret();
  } catch {
    // Real mode with no secret configured: no token could have been
    // validly issued, so every token is treated as invalid.
    return null;
  }

  const expected = Buffer.from(sign(payloadB64, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let payload: UnsubscribeTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.mid !== "string" || typeof payload.exp !== "number") {
    return null;
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return { messageId: payload.mid };
}

function getAppUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  // Dev-only fallback. DEMO_MODE never actually sends an email (see
  // lib/email/send-email.ts), so this is never mailed to a real
  // recipient — a real send additionally requires APP_URL below.
  return "http://localhost:3000";
}

/**
 * Builds the full unsubscribe URL for one outreach message. While
 * DEMO_MODE=false, both a real OUTREACH_UNSUBSCRIBE_SECRET and a real
 * APP_URL are required — missing either throws here, before
 * lib/outreach/send-outreach.ts ever calls the email provider, so a real
 * send fails safely rather than mailing a broken or insecure link.
 */
export function buildUnsubscribeUrl(messageId: string): string {
  if (!isDemoModeEnabled() && !process.env.APP_URL?.trim()) {
    throw new EmailProviderError(
      "MISSING_CREDENTIALS",
      "Outreach email cannot be sent: APP_URL is not configured for the unsubscribe link.",
      false
    );
  }
  const token = signUnsubscribeToken(messageId);
  return `${getAppUrl()}/api/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
}
