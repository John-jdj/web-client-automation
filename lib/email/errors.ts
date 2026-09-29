export type EmailProviderErrorCode =
  | "MISSING_CREDENTIALS"
  | "AUTH_FAILED"
  | "ACCESS_DENIED"
  | "INVALID_REQUEST"
  | "QUOTA_EXCEEDED"
  | "UPSTREAM_UNAVAILABLE"
  | "UNKNOWN";

/**
 * Safe-to-display error for email send failures. Mirrors
 * lib/vercel/errors.ts's DeploymentError shape/rationale exactly.
 */
export class EmailProviderError extends Error {
  code: EmailProviderErrorCode;
  retryable: boolean;

  constructor(code: EmailProviderErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "EmailProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** Classifies a failed Resend API response by HTTP status only — never by string-matching the body. */
export function classifyEmailProviderStatus(status: number, requestId?: string | null): EmailProviderError {
  if (status === 401) {
    return new EmailProviderError("AUTH_FAILED", "Email provider authentication failed.", false);
  }
  if (status === 403) {
    return new EmailProviderError("ACCESS_DENIED", "Email provider access denied.", false);
  }
  if (status === 400 || status === 422) {
    // Diagnostic only, server-side — never surfaced to the browser (see
    // lib/ai/errors.ts's identical pattern for the Claude API).
    console.error("[email] invalid request:", { status, requestId: requestId ?? null });
    return new EmailProviderError("INVALID_REQUEST", "Invalid request sent to email provider.", false);
  }
  if (status === 429) {
    return new EmailProviderError("QUOTA_EXCEEDED", "Email provider rate limit exceeded.", true);
  }
  if (status >= 500) {
    return new EmailProviderError("UPSTREAM_UNAVAILABLE", "Email provider is temporarily unavailable.", true);
  }
  return new EmailProviderError("UNKNOWN", "Email send request failed.", false);
}

export function classifyEmailNetworkError(err: unknown): EmailProviderError {
  const e = err as { name?: string; message?: string } | undefined;
  if (e?.name === "TypeError" || e?.name === "AbortError") {
    return new EmailProviderError("UPSTREAM_UNAVAILABLE", "Could not reach the email provider.", true);
  }
  return new EmailProviderError("UNKNOWN", e?.message ?? "Email send request failed.", false);
}
