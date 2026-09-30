import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function freshTokenModule() {
  vi.resetModules();
  return import("@/lib/outreach/unsubscribe-token");
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("signUnsubscribeToken / verifyUnsubscribeToken", () => {
  it("round-trips a valid token", async () => {
    process.env.DEMO_MODE = "true";
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await freshTokenModule();
    const token = signUnsubscribeToken("11111111-1111-4111-8111-111111111111");
    expect(verifyUnsubscribeToken(token)).toEqual({
      messageId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("rejects a tampered signature", async () => {
    process.env.DEMO_MODE = "true";
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await freshTokenModule();
    const token = signUnsubscribeToken("m1");
    const [payload, sig] = token.split(".");
    const flipped = sig.at(-1) === "a" ? "b" : "a";
    const tampered = `${payload}.${sig.slice(0, -1)}${flipped}`;
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it("rejects a tampered payload (a valid signature from a different message pasted on)", async () => {
    process.env.DEMO_MODE = "true";
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await freshTokenModule();
    const tokenA = signUnsubscribeToken("message-a");
    const tokenB = signUnsubscribeToken("message-b");
    const [, sigA] = tokenA.split(".");
    const [payloadB] = tokenB.split(".");
    expect(verifyUnsubscribeToken(`${payloadB}.${sigA}`)).toBeNull();
  });

  it("rejects malformed tokens without throwing", async () => {
    process.env.DEMO_MODE = "true";
    const { verifyUnsubscribeToken } = await freshTokenModule();
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken(null)).toBeNull();
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
    expect(verifyUnsubscribeToken(42)).toBeNull();
    expect(verifyUnsubscribeToken("a.b.c")).toBeNull();
    expect(verifyUnsubscribeToken("only-one-part")).toBeNull();
  });

  it("rejects an expired token", async () => {
    process.env.DEMO_MODE = "true";
    process.env.OUTREACH_UNSUBSCRIBE_TOKEN_TTL_DAYS = "0.0000001"; // ~8.6ms
    vi.useFakeTimers();
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await freshTokenModule();
    const token = signUnsubscribeToken("m1");
    vi.advanceTimersByTime(1000);
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("accepts a token that has not yet expired", async () => {
    process.env.DEMO_MODE = "true";
    process.env.OUTREACH_UNSUBSCRIBE_TOKEN_TTL_DAYS = "30";
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await freshTokenModule();
    const token = signUnsubscribeToken("m1");
    expect(verifyUnsubscribeToken(token)).toEqual({ messageId: "m1" });
  });

  it("the token payload never contains a raw email address, only the message id and an expiry", async () => {
    process.env.DEMO_MODE = "true";
    const { signUnsubscribeToken } = await freshTokenModule();
    const token = signUnsubscribeToken("m1");
    const [payloadB64] = token.split(".");
    const decoded = Buffer.from(payloadB64, "base64url").toString("utf-8");
    expect(decoded).not.toMatch(/@/);
    expect(JSON.parse(decoded)).toEqual({ mid: "m1", exp: expect.any(Number) });
  });
});

describe("DEMO_MODE fallback secret", () => {
  it("signs and verifies with no OUTREACH_UNSUBSCRIBE_SECRET set, while DEMO_MODE=true", async () => {
    process.env.DEMO_MODE = "true";
    delete process.env.OUTREACH_UNSUBSCRIBE_SECRET;
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await freshTokenModule();
    const token = signUnsubscribeToken("m1");
    expect(verifyUnsubscribeToken(token)).toEqual({ messageId: "m1" });
  });

  it("a real configured secret is used over the fallback when both DEMO_MODE and the secret are set", async () => {
    process.env.DEMO_MODE = "true";
    process.env.OUTREACH_UNSUBSCRIBE_SECRET = "a-real-configured-secret";
    const { signUnsubscribeToken, verifyUnsubscribeToken } = await freshTokenModule();
    const token = signUnsubscribeToken("m1");
    expect(verifyUnsubscribeToken(token)).toEqual({ messageId: "m1" });
  });
});

describe("buildUnsubscribeUrl (real-mode safety gate)", () => {
  it("throws instead of building a URL when DEMO_MODE=false and no secret is configured", async () => {
    process.env.DEMO_MODE = "false";
    delete process.env.OUTREACH_UNSUBSCRIBE_SECRET;
    process.env.APP_URL = "https://example.com";
    const { buildUnsubscribeUrl } = await freshTokenModule();
    const { EmailProviderError } = await import("@/lib/email/errors");
    expect(() => buildUnsubscribeUrl("m1")).toThrow(EmailProviderError);
  });

  it("throws instead of building a URL when DEMO_MODE=false and APP_URL is not configured", async () => {
    process.env.DEMO_MODE = "false";
    process.env.OUTREACH_UNSUBSCRIBE_SECRET = "a-real-secret";
    delete process.env.APP_URL;
    const { buildUnsubscribeUrl } = await freshTokenModule();
    const { EmailProviderError } = await import("@/lib/email/errors");
    expect(() => buildUnsubscribeUrl("m1")).toThrow(EmailProviderError);
  });

  it("builds a real URL when DEMO_MODE=false with both the secret and APP_URL configured", async () => {
    process.env.DEMO_MODE = "false";
    process.env.OUTREACH_UNSUBSCRIBE_SECRET = "a-real-secret";
    process.env.APP_URL = "https://example.com/";
    const { buildUnsubscribeUrl } = await freshTokenModule();
    const url = buildUnsubscribeUrl("m1");
    expect(url.startsWith("https://example.com/api/outreach/unsubscribe?token=")).toBe(true);
  });

  it("builds a URL in DEMO_MODE with no env configured at all", async () => {
    process.env.DEMO_MODE = "true";
    delete process.env.OUTREACH_UNSUBSCRIBE_SECRET;
    delete process.env.APP_URL;
    const { buildUnsubscribeUrl } = await freshTokenModule();
    const url = buildUnsubscribeUrl("m1");
    expect(url).toContain("/api/outreach/unsubscribe?token=");
  });

  it("never includes the secret, or a raw email, in the built URL", async () => {
    process.env.DEMO_MODE = "true";
    process.env.OUTREACH_UNSUBSCRIBE_SECRET = "super-secret-value";
    const { buildUnsubscribeUrl } = await freshTokenModule();
    const url = buildUnsubscribeUrl("m1");
    expect(url).not.toContain("super-secret-value");
    expect(url).not.toMatch(/@/);
  });
});
