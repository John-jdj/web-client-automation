import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function freshAdapter() {
  vi.resetModules();
  return import("@/lib/vercel/deploy-adapter");
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deployToVercel (DEMO_MODE mock path)", () => {
  it("never calls fetch and returns a deterministic, clearly-mock result", async () => {
    process.env.DEMO_MODE = "true";
    delete process.env.VERCEL_TOKEN;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { deployToVercel } = await freshAdapter();
    const result = await deployToVercel({ deploymentName: "abc-bakery-1234", html: "<html></html>" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.usedMock).toBe(true);
    expect(result.status).toBe("READY");
    expect(result.deploymentUrl).toBe("https://abc-bakery-1234.demo-mode.invalid");
    expect(result.deploymentId).toBe("mock_dpl_abc-bakery-1234");
  });

  it("is deterministic for the same deployment name", async () => {
    process.env.DEMO_MODE = "true";
    const { deployToVercel } = await freshAdapter();

    const a = await deployToVercel({ deploymentName: "same-name", html: "<html></html>" });
    const b = await deployToVercel({ deploymentName: "same-name", html: "<html>different content</html>" });

    expect(a.deploymentId).toBe(b.deploymentId);
    expect(a.deploymentUrl).toBe(b.deploymentUrl);
  });

  it("DEMO_MODE still wins even when Vercel credentials are configured", async () => {
    process.env.DEMO_MODE = "true";
    process.env.VERCEL_TOKEN = "fake-token-for-test";
    process.env.VERCEL_PROJECT_ID = "prj_fake";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { deployToVercel } = await freshAdapter();
    const result = await deployToVercel({ deploymentName: "x", html: "<html></html>" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.usedMock).toBe(true);
  });
});

describe("deployToVercel (real path guard, no network call)", () => {
  it("throws MISSING_CREDENTIALS when DEMO_MODE=false and no token/project is configured", async () => {
    process.env.DEMO_MODE = "false";
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_PROJECT_ID;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { deployToVercel } = await freshAdapter();
    const { DeploymentError } = await import("@/lib/vercel/errors");

    await expect(deployToVercel({ deploymentName: "x", html: "<html></html>" })).rejects.toMatchObject({
      code: "MISSING_CREDENTIALS",
    });
    await expect(
      deployToVercel({ deploymentName: "x", html: "<html></html>" })
    ).rejects.toBeInstanceOf(DeploymentError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
