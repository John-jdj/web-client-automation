import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getLead } from "@/lib/db/leads";
import { getBusiness } from "@/lib/db/businesses";
import { getDemo, updateDemo } from "@/lib/db/demos";
import {
  createDeployment,
  getLatestDeploymentForDemo,
  type DemoDeployment,
} from "@/lib/db/demo-deployments";
import { deployToVercel } from "@/lib/vercel/deploy-adapter";
import { renderStaticDemoHtml } from "@/lib/vercel/render-static-demo";
import { DeploymentError } from "@/lib/vercel/errors";
import { VERCEL_PROVIDER } from "@/lib/vercel/config";
import { DemoContentSchema } from "@/lib/validation/schemas";
import type { DemoStatus, DemoDeploymentStatus } from "@/lib/supabase/database.types";

const MAX_ATTEMPTS = 2;

/** Demo statuses a deployment may be attempted from — mirrors Step 8's DemoStatus. */
const DEPLOYABLE_DEMO_STATUSES: DemoStatus[] = [
  "GENERATED",
  "DEPLOYMENT_PENDING",
  "DEPLOYED",
  "FAILED",
];

/** Deployment states treated as "already handled" — an idempotent re-call returns these, not a fresh deployment. */
const ACTIVE_OR_SUCCESSFUL: DemoDeploymentStatus[] = ["PENDING", "BUILDING", "READY"];

export type DeployDemoIneligibleCode =
  | "DEMO_NOT_FOUND"
  | "LEAD_NOT_FOUND"
  | "BUSINESS_NOT_FOUND"
  | "NOT_GENERATED"
  | "INVALID_CONTENT";

export class DeployDemoIneligibleError extends Error {
  code: DeployDemoIneligibleCode;
  constructor(code: DeployDemoIneligibleCode, message: string) {
    super(message);
    this.name = "DeployDemoIneligibleError";
    this.code = code;
  }
}

export interface DeployDemoResult {
  alreadyDeployed: boolean;
  demoId: string;
  deploymentId: string | null;
  deploymentUrl: string | null;
  status: DemoDeploymentStatus;
  usedMock: boolean;
}

function toResult(deployment: DemoDeployment, alreadyDeployed: boolean): DeployDemoResult {
  return {
    alreadyDeployed,
    demoId: deployment.demo_id,
    deploymentId: deployment.deployment_id,
    deploymentUrl: deployment.deployment_url,
    status: deployment.status,
    usedMock: Boolean(deployment.deployment_url?.endsWith(".demo-mode.invalid")),
  };
}

/**
 * Runs Step 9 for one demo: verify it (and its lead/business) exist and
 * are visible to the caller (RLS-scoped `createClient()`, same pattern as
 * lib/demo/generate-demo.ts — an unauthorized user simply gets "not
 * found", never a distinct authorization error that would leak
 * existence) → render a secrets-free static page → deploy via the
 * DEMO_MODE/real Vercel adapter → persist the result. Idempotent unless
 * the latest deployment is FAILED/CANCELLED, in which case a fresh
 * attempt is made and recorded as a new demo_deployments row.
 */
export async function deployDemo(demoId: string): Promise<DeployDemoResult> {
  const demo = await getDemo(demoId);
  if (!demo) {
    throw new DeployDemoIneligibleError("DEMO_NOT_FOUND", "Demo not found.");
  }

  const lead = await getLead(demo.lead_id);
  if (!lead) {
    throw new DeployDemoIneligibleError("LEAD_NOT_FOUND", "Lead not found for this demo.");
  }
  const business = await getBusiness(lead.business_id);
  if (!business) {
    throw new DeployDemoIneligibleError("BUSINESS_NOT_FOUND", "Business not found for this demo.");
  }

  if (!DEPLOYABLE_DEMO_STATUSES.includes(demo.status)) {
    throw new DeployDemoIneligibleError(
      "NOT_GENERATED",
      "This demo has not been generated yet — generate it before deploying."
    );
  }

  const existing = await getLatestDeploymentForDemo(demoId);
  if (existing && ACTIVE_OR_SUCCESSFUL.includes(existing.status)) {
    return toResult(existing, true);
  }

  const parsedContent = DemoContentSchema.safeParse(demo.generated_content);
  if (!parsedContent.success) {
    throw new DeployDemoIneligibleError(
      "INVALID_CONTENT",
      "This demo's generated content is missing or invalid — regenerate it before deploying."
    );
  }

  const html = renderStaticDemoHtml(business.business_name, parsedContent.data);
  const attemptBase = existing?.status === "FAILED" ? existing.attempt_count : 0;

  await updateDemo(demoId, { status: "DEPLOYMENT_PENDING" });

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = new Date().toISOString();
    try {
      const result = await deployToVercel({ deploymentName: demo.slug, html });

      const deployment = await createDeployment({
        demo_id: demoId,
        provider: VERCEL_PROVIDER,
        deployment_id: result.deploymentId,
        deployment_url: result.deploymentUrl,
        status: result.status,
        attempt_count: attemptBase + attempt,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      });

      await updateDemo(demoId, {
        status: result.status === "READY" ? "DEPLOYED" : "FAILED",
        deployment_url: result.deploymentUrl,
      });

      if (!result.usedMock) {
        await logDeploymentUsage();
      }

      return toResult(deployment, false);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof DeploymentError ? err.retryable : false;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
    }
  }

  const message =
    lastError instanceof DeploymentError
      ? lastError.message
      : lastError instanceof Error
        ? lastError.message
        : "Demo deployment failed.";

  // Every attempt failed — the failure is still recorded (demo_deployments
  // row + demos.status="FAILED") before throwing, so callers (including
  // the batch route) can see exactly what happened without needing to
  // catch anything themselves; only the thrown error decides the HTTP
  // response, mirroring lib/ai/analyze-lead.ts's identical shape.
  await createDeployment({
    demo_id: demoId,
    provider: VERCEL_PROVIDER,
    status: "FAILED",
    error_message: message,
    attempt_count: attemptBase + MAX_ATTEMPTS,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });
  await updateDemo(demoId, { status: "FAILED" });
  await logDeploymentError(demoId, lastError);

  throw lastError instanceof DeploymentError ? lastError : new DeploymentError("UNKNOWN", message, false);
}

async function logDeploymentUsage() {
  const supabase = await createClient();
  await supabase.from("api_usage").insert({
    provider: VERCEL_PROVIDER,
    operation: "demo_deployment",
    quantity: 1,
  });
}

async function logDeploymentError(demoId: string, err: unknown) {
  const supabase = await createClient();
  const message =
    err instanceof DeploymentError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Unknown demo deployment error.";
  const demo = await getDemo(demoId);
  await supabase.from("error_logs").insert({
    service: "demo_deployment",
    message,
    lead_id: demo?.lead_id ?? null,
  });
}
