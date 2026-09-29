export type DeploymentErrorCode =
  | "MISSING_CREDENTIALS"
  | "AUTH_FAILED"
  | "ACCESS_DENIED"
  | "INVALID_REQUEST"
  | "QUOTA_EXCEEDED"
  | "UPSTREAM_UNAVAILABLE"
  | "UNKNOWN";

/**
 * Safe-to-display error for Vercel deployment failures. Mirrors
 * lib/ai/errors.ts's AnalysisError shape/rationale — `retryable` drives
 * lib/demo/deploy-demo.ts's bounded retry loop, and the message is never
 * the raw Vercel response body (which could otherwise echo back part of
 * the request).
 */
export class DeploymentError extends Error {
  code: DeploymentErrorCode;
  retryable: boolean;

  constructor(code: DeploymentErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "DeploymentError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Classifies a failed Vercel API response by HTTP status only — never by
 * string-matching the response body, and never logging the request
 * (which carries the Bearer token in its headers).
 */
export function classifyVercelStatus(status: number, requestId?: string | null): DeploymentError {
  if (status === 401) {
    return new DeploymentError("AUTH_FAILED", "Vercel API authentication failed.", false);
  }
  if (status === 403) {
    return new DeploymentError("ACCESS_DENIED", "Vercel API access denied.", false);
  }
  if (status === 400 || status === 422) {
    // Diagnostic only, server-side — never surfaced to the browser (see
    // lib/ai/errors.ts's identical pattern for the Claude API).
    console.error("[vercel] invalid request:", { status, requestId: requestId ?? null });
    return new DeploymentError("INVALID_REQUEST", "Invalid request sent to Vercel API.", false);
  }
  if (status === 429) {
    return new DeploymentError("QUOTA_EXCEEDED", "Vercel API rate limit exceeded.", true);
  }
  if (status >= 500) {
    return new DeploymentError("UPSTREAM_UNAVAILABLE", "Vercel API is temporarily unavailable.", true);
  }
  return new DeploymentError("UNKNOWN", "Vercel deployment request failed.", false);
}

export function classifyVercelNetworkError(err: unknown): DeploymentError {
  const e = err as { name?: string; message?: string } | undefined;
  if (e?.name === "TypeError" || e?.name === "AbortError") {
    return new DeploymentError("UPSTREAM_UNAVAILABLE", "Could not reach the Vercel API.", true);
  }
  return new DeploymentError(
    "UNKNOWN",
    e?.message ?? "Vercel deployment request failed.",
    false
  );
}
