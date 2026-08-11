import { describe, expect, it } from "vitest";
import { classifyGoogleApiError } from "@/lib/google/errors";

describe("classifyGoogleApiError", () => {
  it("classifies 401 as authentication failure", () => {
    const err = classifyGoogleApiError(401, "UNAUTHENTICATED", undefined);
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.message).toBe("Google Places API authentication failed.");
    expect(err.retryable).toBe(false);
  });

  it("classifies 403 with a billing hint as a billing error", () => {
    const err = classifyGoogleApiError(
      403,
      "PERMISSION_DENIED",
      "This API method requires billing to be enabled."
    );
    expect(err.code).toBe("ACCESS_DENIED");
    expect(err.message).toBe("Google billing may not be enabled.");
  });

  it("classifies a generic 403 as access denied", () => {
    const err = classifyGoogleApiError(403, "PERMISSION_DENIED", "Forbidden");
    expect(err.code).toBe("ACCESS_DENIED");
    expect(err.message).toContain("access denied");
  });

  it("classifies 429 as quota exceeded and retryable", () => {
    const err = classifyGoogleApiError(429, "RESOURCE_EXHAUSTED", undefined);
    expect(err.code).toBe("QUOTA_EXCEEDED");
    expect(err.retryable).toBe(true);
  });

  it("classifies 400 as an invalid request, not retryable", () => {
    const err = classifyGoogleApiError(400, "INVALID_ARGUMENT", undefined);
    expect(err.code).toBe("INVALID_REQUEST");
    expect(err.retryable).toBe(false);
  });

  it("classifies 5xx as a retryable upstream failure", () => {
    const err = classifyGoogleApiError(503, undefined, undefined);
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(err.retryable).toBe(true);
  });

  it("never echoes the raw Google message back", () => {
    const err = classifyGoogleApiError(403, "PERMISSION_DENIED", "secret internal detail xyz");
    expect(err.message).not.toContain("secret internal detail xyz");
  });
});
