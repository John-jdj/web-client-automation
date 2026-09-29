import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/demo/deploy-demo", () => ({
  deployDemo: vi.fn(),
  DeployDemoIneligibleError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

const { createClient } = await import("@/lib/supabase/server");
const { deployDemo, DeployDemoIneligibleError } = await import("@/lib/demo/deploy-demo");
const { DeploymentError } = await import("@/lib/vercel/errors");
const { POST: deployOne } = await import("@/app/api/demos/[id]/deploy/route");
const { POST: deployBatch } = await import("@/app/api/demos/deploy-batch/route");

let fake: FakeSupabase;

function seedSettings(
  overrides: Partial<{ daily_deployment_limit: number; auto_deployment_enabled: boolean }> = {}
) {
  fake._seed("automation_settings", [
    {
      id: "settings_1",
      auto_deployment_enabled: true,
      daily_deployment_limit: 20,
      ...overrides,
    },
  ]);
}

function seedCandidateDemos(ids: string[]) {
  fake._seed(
    "demos",
    ids.map((id) => ({ id, status: "GENERATED", created_at: new Date().toISOString() }))
  );
}

function req(url: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(fake as never);
  vi.mocked(deployDemo).mockReset();
});

describe("POST /api/demos/[id]/deploy (auth)", () => {
  it("rejects an unauthenticated request", async () => {
    fake._setUser(null);
    const response = await deployOne(req("http://localhost/api/demos/demo1/deploy"), {
      params: Promise.resolve({ id: "demo1" }),
    });
    expect(response.status).toBe(401);
    expect(deployDemo).not.toHaveBeenCalled();
  });

  it("deploys on behalf of an authenticated user and returns the adapter result", async () => {
    vi.mocked(deployDemo).mockResolvedValue({
      alreadyDeployed: false,
      demoId: "demo1",
      deploymentId: "mock_dpl_demo1",
      deploymentUrl: "https://demo1.demo-mode.invalid",
      status: "READY",
      usedMock: true,
    });

    const response = await deployOne(req("http://localhost/api/demos/demo1/deploy"), {
      params: Promise.resolve({ id: "demo1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deploymentUrl).toBe("https://demo1.demo-mode.invalid");
    expect(deployDemo).toHaveBeenCalledWith("demo1");
  });

  it("rejects an invalid/nonexistent demo with 404", async () => {
    vi.mocked(deployDemo).mockRejectedValue(new DeployDemoIneligibleError("DEMO_NOT_FOUND", "Demo not found."));

    const response = await deployOne(req("http://localhost/api/demos/missing/deploy"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it("never leaks a DeploymentError's internals beyond its safe message", async () => {
    vi.mocked(deployDemo).mockRejectedValue(
      new DeploymentError("UPSTREAM_UNAVAILABLE", "Vercel API is temporarily unavailable.", true)
    );

    const response = await deployOne(req("http://localhost/api/demos/demo1/deploy"), {
      params: Promise.resolve({ id: "demo1" }),
    });
    const body = await response.json();
    expect(body.error).toBe("Vercel API is temporarily unavailable.");
    expect(JSON.stringify(body)).not.toMatch(/VERCEL_TOKEN|Bearer /i);
  });
});

describe("POST /api/demos/deploy-batch (auth + validation)", () => {
  it("rejects an unauthenticated request", async () => {
    fake._setUser(null);
    const response = await deployBatch(req("http://localhost/api/demos/deploy-batch", { limit: 10 }));
    expect(response.status).toBe(401);
  });

  it("rejects an invalid request body", async () => {
    seedSettings();
    const response = await deployBatch(req("http://localhost/api/demos/deploy-batch", { limit: -1 }));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/demos/deploy-batch (limit + toggles)", () => {
  it("respects daily_deployment_limit and does not exceed it", async () => {
    seedSettings({ daily_deployment_limit: 2 });
    seedCandidateDemos(["demo1", "demo2", "demo3", "demo4"]);

    vi.mocked(deployDemo).mockImplementation(async (demoId: string) => ({
      alreadyDeployed: false,
      demoId,
      deploymentId: `mock_dpl_${demoId}`,
      deploymentUrl: `https://${demoId}.demo-mode.invalid`,
      status: "READY",
      usedMock: true,
    }));

    const response = await deployBatch(req("http://localhost/api/demos/deploy-batch", { limit: 10 }));
    const body = await response.json();

    expect(body.summary.deployed).toBe(2); // capped, not the requested 10
    expect(deployDemo).toHaveBeenCalledTimes(2);
  });

  it("accounts for deployments already logged today before allowing more", async () => {
    seedSettings({ daily_deployment_limit: 1 });
    seedCandidateDemos(["demo5"]);
    fake._seed("api_usage", [
      { id: "u1", provider: "vercel", operation: "demo_deployment", created_at: new Date().toISOString() },
    ]);

    const response = await deployBatch(req("http://localhost/api/demos/deploy-batch", { limit: 10 }));
    const body = await response.json();

    expect(body.summary.deployed).toBe(0);
    expect(body.message).toMatch(/daily deployment limit reached/i);
    expect(deployDemo).not.toHaveBeenCalled();
  });

  it("does not deploy at all when auto_deployment_enabled is false", async () => {
    seedSettings({ auto_deployment_enabled: false });
    seedCandidateDemos(["demo6"]);

    const response = await deployBatch(req("http://localhost/api/demos/deploy-batch", { limit: 10 }));
    const body = await response.json();

    expect(body.summary.deployed).toBe(0);
    expect(deployDemo).not.toHaveBeenCalled();
  });

  it("reports per-demo success and failure without aborting the batch", async () => {
    seedSettings();
    seedCandidateDemos(["demo7", "demo8", "demo9"]);

    vi.mocked(deployDemo).mockImplementation(async (demoId: string) => {
      if (demoId === "demo8") {
        throw new DeploymentError("UPSTREAM_UNAVAILABLE", "Vercel API is temporarily unavailable.", true);
      }
      return {
        alreadyDeployed: false,
        demoId,
        deploymentId: `mock_dpl_${demoId}`,
        deploymentUrl: `https://${demoId}.demo-mode.invalid`,
        status: "READY",
        usedMock: true,
      };
    });

    const response = await deployBatch(req("http://localhost/api/demos/deploy-batch", { limit: 10 }));
    const body = await response.json();

    expect(body.summary.deployed).toBe(2);
    expect(body.summary.failed).toBe(1);
    expect(deployDemo).toHaveBeenCalledTimes(3); // one failure didn't stop the batch
  });
});
