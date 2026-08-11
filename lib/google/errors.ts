export type DiscoveryErrorCode =
  | "MISSING_API_KEY"
  | "AUTH_FAILED"
  | "ACCESS_DENIED"
  | "QUOTA_EXCEEDED"
  | "INVALID_REQUEST"
  | "UPSTREAM_UNAVAILABLE"
  | "TIMEOUT"
  | "UNKNOWN";

/**
 * Safe-to-display error for Google Places failures. `message` is written
 * to be shown directly to the user — it never contains the API key or raw
 * upstream error bodies.
 */
export class DiscoveryError extends Error {
  code: DiscoveryErrorCode;
  httpStatus: number;
  retryable: boolean;

  constructor(
    code: DiscoveryErrorCode,
    message: string,
    httpStatus: number,
    retryable = false
  ) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

/**
 * Classifies a Places API (New) HTTP error response into a safe,
 * user-facing DiscoveryError. `googleStatus`/`googleMessage` come from the
 * response body's `error.status` / `error.message` and are only inspected
 * for known substrings (e.g. "billing") — never echoed back verbatim.
 */
export function classifyGoogleApiError(
  httpStatus: number,
  googleStatus: string | undefined,
  googleMessage: string | undefined
): DiscoveryError {
  const lowerMessage = (googleMessage ?? "").toLowerCase();

  if (httpStatus === 401 || googleStatus === "UNAUTHENTICATED") {
    return new DiscoveryError(
      "AUTH_FAILED",
      "Google Places API authentication failed.",
      401,
      false
    );
  }

  if (httpStatus === 403 || googleStatus === "PERMISSION_DENIED") {
    if (lowerMessage.includes("billing")) {
      return new DiscoveryError(
        "ACCESS_DENIED",
        "Google billing may not be enabled.",
        403,
        false
      );
    }
    return new DiscoveryError(
      "ACCESS_DENIED",
      "Google Places API access denied — check API key restrictions and billing.",
      403,
      false
    );
  }

  if (httpStatus === 429 || googleStatus === "RESOURCE_EXHAUSTED") {
    return new DiscoveryError(
      "QUOTA_EXCEEDED",
      "Google Places API quota was exceeded.",
      429,
      true
    );
  }

  if (httpStatus === 400 || googleStatus === "INVALID_ARGUMENT") {
    return new DiscoveryError(
      "INVALID_REQUEST",
      "Invalid request sent to Google Places API.",
      400,
      false
    );
  }

  if (httpStatus >= 500) {
    return new DiscoveryError(
      "UPSTREAM_UNAVAILABLE",
      "Google Places API is temporarily unavailable.",
      502,
      true
    );
  }

  return new DiscoveryError(
    "UNKNOWN",
    "Google Places API request failed.",
    502,
    false
  );
}
