export type AnalysisErrorCode =
  | "MISSING_API_KEY"
  | "AUTH_FAILED"
  | "ACCESS_DENIED"
  | "INVALID_REQUEST"
  | "QUOTA_EXCEEDED"
  | "UPSTREAM_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "UNKNOWN";

/**
 * Safe-to-display error for Claude analysis failures. `retryable` drives
 * lib/ai/analyze-lead.ts's retry loop — never retry auth/permission/invalid
 * request errors, only transient upstream ones (and a schema-invalid
 * response, handled separately by the caller).
 */
export class AnalysisError extends Error {
  code: AnalysisErrorCode;
  retryable: boolean;

  constructor(code: AnalysisErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Classifies an error thrown by the Anthropic SDK using its typed
 * exception classes (never string-matching messages).
 */
export function classifyAnthropicError(err: unknown): AnalysisError {
  const e = err as { status?: number; name?: string; message?: string } | undefined;
  const status = e?.status;

  if (status === 401) {
    return new AnalysisError("AUTH_FAILED", "Claude API authentication failed.", false);
  }
  if (status === 403) {
    return new AnalysisError("ACCESS_DENIED", "Claude API access denied.", false);
  }
  if (status === 400 || status === 422) {
    return new AnalysisError("INVALID_REQUEST", "Invalid request sent to Claude API.", false);
  }
  if (status === 429) {
    return new AnalysisError("QUOTA_EXCEEDED", "Claude API rate limit or quota exceeded.", true);
  }
  if (status !== undefined && status >= 500) {
    return new AnalysisError(
      "UPSTREAM_UNAVAILABLE",
      "Claude API is temporarily unavailable.",
      true
    );
  }
  if (e?.name === "APIConnectionError") {
    return new AnalysisError("UPSTREAM_UNAVAILABLE", "Could not reach the Claude API.", true);
  }

  return new AnalysisError(
    "UNKNOWN",
    e?.message ?? "Claude API request failed.",
    false
  );
}
