import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/vercel/deploy-adapter", () => ({
  deployToVercel: vi.fn(),
}));

const { createClient } = await import("@/lib/supabase/server");
const { deployToVercel } = await import("@/lib/vercel/deploy-adapter");
const { deployDemo, DeployDemoIneligibleError } = await import("@/lib/demo/deploy-demo");
const { DeploymentError } = await import("@/lib/vercel/errors");

let fake: FakeSupabase;

const ids = new Map<string, string>();
function uuid(label: string): string {
  if (!ids.has(label)) ids.set(label, randomUUID());
  return ids.get(label)!;
}

const VALID_CONTENT = {
  tagline: "ABC Bakery — Bakery in Dindigul",
  heroHeadline: "Welcome to ABC Bakery",
  heroSubheadline: "A busy local bakery.",
  aboutText: "A busy local bakery serving fresh bread daily.",
  services: [{ title: "Custom cakes", description: "Order a custom cake for any occasion." }],
  whyChooseUs: ["Fresh daily", "Friendly staff"],
  ctaText: "Order Now",
  templateSlug: "general-business",
  templateName: "General Business",
  designStyle: "Clean and modern",
  contactInfo: { phone: "+919876543210", address: "1 Main Street", city: "Dindigul" },
};

function seedPipeline(overrides: {
  businessId: string;
  leadId: string;
  demoId: string;
  demoStatus?: string;
  generatedContent?: unknown;
}) {
  fake._seed("businesses", [
    {
      id: overrides.businessId,
      business_name: "ABC Bakery",
      category: "Bakery",
      has_website: false,
    },
  ]);
  fake._seed("leads", [
    {
      id: overrides.leadId,
      business_id: overrides.businessId,
      status: "DEMO_CREATED",
      qualification_status: "QUALIFIED",
      created_at: new Date().toISOString(),
    },
  ]);
  fake._seed("demos", [
    {
      id: overrides.demoId,
      lead_id: overrides.leadId,
      name: "ABC Bakery — Demo Website",
      slug: "abc-bakery-demo",
      status: overrides.demoStatus ?? "GENERATED",
      generated_content: overrides.generatedContent === undefined ? VALID_CONTENT : overrides.generatedContent,
      created_at: new Date().toISOString(),
    },
  ]);
}

const MOCK_DEPLOY_RESULT = {
  usedMock: true,
  deploymentId: "mock_dpl_abc-bakery-demo",
  deploymentUrl: "https://abc-bakery-demo.demo-mode.invalid",
  status: "READY" as const,
};

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(fake as never);
  vi.mocked(deployToVercel).mockReset();
});

describe("deployDemo (eligibility)", () => {
  it("rejects an unknown demo id", async () => {
    await expect(deployDemo(randomUUID())).rejects.toThrow(DeployDemoIneligibleError);
    expect(deployToVercel).not.toHaveBeenCalled();
  });

  it("rejects a demo that has never been generated (DRAFT)", async () => {
    seedPipeline({ businessId: uuid("b1"), leadId: uuid("l1"), demoId: uuid("d1"), demoStatus: "DRAFT" });
    await expect(deployDemo(uuid("d1"))).rejects.toThrow(DeployDemoIneligibleError);
    expect(deployToVercel).not.toHaveBeenCalled();
  });

  it("rejects a demo with missing/invalid generated_content", async () => {
    seedPipeline({ businessId: uuid("b2"), leadId: uuid("l2"), demoId: uuid("d2"), generatedContent: null });
    await expect(deployDemo(uuid("d2"))).rejects.toThrow(DeployDemoIneligibleError);
    expect(deployToVercel).not.toHaveBeenCalled();
  });
});

describe("deployDemo (successful DEMO_MODE-style deployment)", () => {
  it("deploys a generated demo and persists status/url on both tables", async () => {
    seedPipeline({ businessId: uuid("b3"), leadId: uuid("l3"), demoId: uuid("d3") });
    vi.mocked(deployToVercel).mockResolvedValue(MOCK_DEPLOY_RESULT);

    const result = await deployDemo(uuid("d3"));

    expect(result.alreadyDeployed).toBe(false);
    expect(result.usedMock).toBe(true);
    expect(result.status).toBe("READY");
    expect(result.deploymentUrl).toBe(MOCK_DEPLOY_RESULT.deploymentUrl);

    const deployments = fake._dump()["demo_deployments"] as Array<{ demo_id: string; status: string }>;
    expect(deployments).toHaveLength(1);
    expect(deployments[0].demo_id).toBe(uuid("d3"));
    expect(deployments[0].status).toBe("READY");

    const demos = fake._dump()["demos"] as Array<{ id: string; status: string; deployment_url: string | null }>;
    const demo = demos.find((d) => d.id === uuid("d3"));
    expect(demo?.status).toBe("DEPLOYED");
    expect(demo?.deployment_url).toBe(MOCK_DEPLOY_RESULT.deploymentUrl);
  });

  it("passes only the rendered HTML and a deployment name to the adapter — no CRM object", async () => {
    seedPipeline({ businessId: uuid("b4"), leadId: uuid("l4"), demoId: uuid("d4") });
    vi.mocked(deployToVercel).mockResolvedValue(MOCK_DEPLOY_RESULT);

    await deployDemo(uuid("d4"));

    expect(deployToVercel).toHaveBeenCalledTimes(1);
    const call = vi.mocked(deployToVercel).mock.calls[0][0];
    expect(Object.keys(call).sort()).toEqual(["deploymentName", "html"]);
    expect(typeof call.html).toBe("string");
    expect(call.html).toContain("Welcome to ABC Bakery");
  });
});

describe("deployDemo (idempotency)", () => {
  it("does not redeploy when a READY deployment already exists", async () => {
    seedPipeline({ businessId: uuid("b5"), leadId: uuid("l5"), demoId: uuid("d5") });
    vi.mocked(deployToVercel).mockResolvedValue(MOCK_DEPLOY_RESULT);

    const first = await deployDemo(uuid("d5"));
    expect(first.alreadyDeployed).toBe(false);
    expect(deployToVercel).toHaveBeenCalledTimes(1);

    const second = await deployDemo(uuid("d5"));
    expect(second.alreadyDeployed).toBe(true);
    expect(second.deploymentUrl).toBe(MOCK_DEPLOY_RESULT.deploymentUrl);
    expect(deployToVercel).toHaveBeenCalledTimes(1); // still 1 — no duplicate deployment

    const deployments = fake._dump()["demo_deployments"] ?? [];
    expect(deployments).toHaveLength(1); // no duplicate row
  });
});

describe("deployDemo (failed deployment status handling)", () => {
  it("records a FAILED demo_deployments row and demos.status, then throws", async () => {
    seedPipeline({ businessId: uuid("b6"), leadId: uuid("l6"), demoId: uuid("d6") });
    vi.mocked(deployToVercel).mockRejectedValue(
      new DeploymentError("UPSTREAM_UNAVAILABLE", "Vercel API is temporarily unavailable.", true)
    );

    await expect(deployDemo(uuid("d6"))).rejects.toThrow(DeploymentError);
    expect(deployToVercel).toHaveBeenCalledTimes(2); // one retry, retryable error

    const deployments = fake._dump()["demo_deployments"] as Array<{ status: string; error_message: string | null }>;
    expect(deployments).toHaveLength(1);
    expect(deployments[0].status).toBe("FAILED");
    expect(deployments[0].error_message).toBe("Vercel API is temporarily unavailable.");

    const demos = fake._dump()["demos"] as Array<{ id: string; status: string }>;
    expect(demos.find((d) => d.id === uuid("d6"))?.status).toBe("FAILED");

    const errorLogs = fake._dump()["error_logs"] ?? [];
    expect(errorLogs).toHaveLength(1);
  });

  it("does not retry a non-retryable error (e.g. missing credentials)", async () => {
    seedPipeline({ businessId: uuid("b7"), leadId: uuid("l7"), demoId: uuid("d7") });
    vi.mocked(deployToVercel).mockRejectedValue(
      new DeploymentError("MISSING_CREDENTIALS", "Vercel deployment credentials are missing.", false)
    );

    await expect(deployDemo(uuid("d7"))).rejects.toThrow(DeploymentError);
    expect(deployToVercel).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh deployment attempt after a prior FAILED one (retry via redeploy)", async () => {
    seedPipeline({ businessId: uuid("b8"), leadId: uuid("l8"), demoId: uuid("d8") });
    vi.mocked(deployToVercel).mockRejectedValue(
      new DeploymentError("MISSING_CREDENTIALS", "Vercel deployment credentials are missing.", false)
    );
    await expect(deployDemo(uuid("d8"))).rejects.toThrow(DeploymentError);

    vi.mocked(deployToVercel).mockResolvedValue(MOCK_DEPLOY_RESULT);
    const result = await deployDemo(uuid("d8"));

    expect(result.alreadyDeployed).toBe(false);
    expect(result.status).toBe("READY");

    const deployments = fake._dump()["demo_deployments"] as Array<{ status: string; attempt_count: number }>;
    expect(deployments).toHaveLength(2); // the failed attempt + the successful retry
    expect(deployments[1].status).toBe("READY");
    expect(deployments[1].attempt_count).toBeGreaterThan(deployments[0].attempt_count);
  });
});
