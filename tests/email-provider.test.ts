import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function freshEmailModule() {
  vi.resetModules();
  return import("@/lib/email/send-email");
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendEmail (DEMO_MODE mock path — never a real network request)", () => {
  it("never calls fetch and returns a simulated result", async () => {
    process.env.DEMO_MODE = "true";
    delete process.env.RESEND_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { sendEmail } = await freshEmailModule();
    const result = await sendEmail({
      to: "owner@example.com",
      subject: "A free demo website",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.usedMock).toBe(true);
    expect(result.simulated).toBe(true);
    expect(result.providerMessageId).toMatch(/^mock_email_/);
  });

  it("is deterministic for the same to+subject", async () => {
    process.env.DEMO_MODE = "true";
    const { sendEmail } = await freshEmailModule();

    const a = await sendEmail({ to: "x@example.com", subject: "Hello", html: "<p>1</p>", text: "1" });
    const b = await sendEmail({ to: "x@example.com", subject: "Hello", html: "<p>2</p>", text: "2" });

    expect(a.providerMessageId).toBe(b.providerMessageId);
  });

  it("DEMO_MODE still wins even when credentials are configured", async () => {
    process.env.DEMO_MODE = "true";
    process.env.RESEND_API_KEY = "fake-key-for-test";
    process.env.EMAIL_FROM = "agency@example.com";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { sendEmail } = await freshEmailModule();
    const result = await sendEmail({ to: "x@example.com", subject: "Hi", html: "<p>hi</p>", text: "hi" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.usedMock).toBe(true);
  });
});

describe("sendEmail (real path guard, no network call)", () => {
  it("throws MISSING_CREDENTIALS when DEMO_MODE=false and no key/from is configured", async () => {
    process.env.DEMO_MODE = "false";
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { sendEmail } = await freshEmailModule();
    const { EmailProviderError } = await import("@/lib/email/errors");

    await expect(
      sendEmail({ to: "x@example.com", subject: "Hi", html: "<p>hi</p>", text: "hi" })
    ).rejects.toBeInstanceOf(EmailProviderError);
    await expect(
      sendEmail({ to: "x@example.com", subject: "Hi", html: "<p>hi</p>", text: "hi" })
    ).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
