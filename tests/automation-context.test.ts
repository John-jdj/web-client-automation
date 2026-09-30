import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

vi.mock("next/headers", () => ({
  // Simulates exactly what happens outside a real Next.js request (e.g. a
  // cron-triggered server process with no incoming HTTP request at all):
  // `cookies()` throws, because there is no request to read cookies from.
  cookies: vi.fn(async () => {
    throw new Error("cookies() called outside a request scope.");
  }),
}));

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
    SUPABASE_SECRET_KEY: "test-service-role-key",
  };
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("getRequestContext (RLS-scoped) needs a real request", () => {
  it("throws when there is no session/request context available (proves the RLS path is session-dependent)", async () => {
    const { getRequestContext } = await import("@/lib/automation/context");
    await expect(getRequestContext()).rejects.toThrow(/cookies\(\) called outside a request scope/);
  });
});

describe("getServiceContext (service-role) runs with no browser session at all", () => {
  it("succeeds with no request/cookies — this is the whole point of Step 11.2", async () => {
    const { getServiceContext } = await import("@/lib/automation/context");
    const context = getServiceContext();
    expect(context.supabase).toBeTruthy();
    // The mocked cookies() would have thrown if anything on this path had
    // touched the RLS-scoped client — it didn't, so getServiceContext()
    // never went near next/headers at all.
  });

  it("never calls next/headers's cookies()", async () => {
    const { cookies } = await import("next/headers");
    const { getServiceContext } = await import("@/lib/automation/context");
    getServiceContext();
    expect(cookies).not.toHaveBeenCalled();
  });
});

describe("lib/db/* helpers default to the RLS-scoped client, unchanged, when no client is injected", () => {
  it("getLead() with no explicit client still goes through the cookie-based path (and so still fails with no session, exactly as before Step 11.2)", async () => {
    const { getLead } = await import("@/lib/db/leads");
    await expect(getLead("11111111-1111-4111-8111-111111111111")).rejects.toThrow(
      /cookies\(\) called outside a request scope/
    );
  });
});

describe("no secret leakage", () => {
  it("getServiceContext() never logs the service-role key", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { getServiceContext } = await import("@/lib/automation/context");
    getServiceContext();

    for (const call of [...consoleErrorSpy.mock.calls, ...consoleLogSpy.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain("test-service-role-key");
    }
  });

});

describe("service-role code is kept under explicit server-only guards", () => {
  it("lib/supabase/service.ts (the service-role client factory) is marked server-only", () => {
    const source = readFileSync(new URL("../lib/supabase/service.ts", import.meta.url), "utf-8");
    expect(source).toMatch(/^import\s+"server-only";/m);
  });

  it("lib/automation/context.ts (where service-role access is granted for automation) is marked server-only", () => {
    const source = readFileSync(new URL("../lib/automation/context.ts", import.meta.url), "utf-8");
    expect(source).toMatch(/^import\s+"server-only";/m);
  });

  it("the service-role key is never read from a NEXT_PUBLIC_ variable anywhere in lib/supabase or lib/automation", () => {
    // \S* (non-whitespace), not .* — a source file may have CRLF line
    // endings, and `.` still matches `\r`, so a greedy `.*` could
    // wrongly "cross" two unrelated lines (e.g. a NEXT_PUBLIC_SUPABASE_URL
    // read on one line and an unrelated SUPABASE_SECRET_KEY read on the
    // next) and report a false positive. \S* only matches within a
    // single contiguous identifier-like token.
    for (const path of ["../lib/supabase/service.ts", "../lib/automation/context.ts"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf-8");
      expect(source).not.toMatch(/NEXT_PUBLIC_\S*SECRET/i);
      expect(source).not.toMatch(/NEXT_PUBLIC_\S*SERVICE_ROLE/i);
    }
  });
});
