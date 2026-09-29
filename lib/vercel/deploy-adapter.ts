import "server-only";
import {
  isDemoModeEnabled,
  isVercelConfigured,
  getVercelToken,
  getVercelOrgId,
  getVercelProjectId,
  VERCEL_API_BASE,
} from "./config";
import { DeploymentError, classifyVercelStatus, classifyVercelNetworkError } from "./errors";

export interface DeployAdapterInput {
  /** Stable per-demo name Vercel will slugify into the deployment URL. */
  deploymentName: string;
  /** Full static HTML for the single-page demo site (see render-static-demo.ts). */
  html: string;
}

export type DeployAdapterStatus = "READY" | "BUILDING" | "FAILED";

export interface DeployAdapterResult {
  usedMock: boolean;
  deploymentId: string;
  deploymentUrl: string;
  status: DeployAdapterStatus;
}

/**
 * Deterministic DEMO_MODE stand-in — no network call, no Vercel token
 * required. `deploymentId`/`deploymentUrl` are derived only from
 * `deploymentName` (itself derived from the demo's slug), so re-running
 * this for the same demo always yields the same identifiers — matching
 * the real adapter closely enough that idempotency logic in
 * lib/demo/deploy-demo.ts doesn't need to know which path ran.
 * The `.invalid` TLD (RFC 2606) makes the mock URL unmistakably not a
 * real, reachable deployment.
 */
function deployMock(input: DeployAdapterInput): DeployAdapterResult {
  return {
    usedMock: true,
    deploymentId: `mock_dpl_${input.deploymentName}`,
    deploymentUrl: `https://${input.deploymentName}.demo-mode.invalid`,
    status: "READY",
  };
}

/**
 * Real Vercel deployment via the Deployments API (v13), uploading a
 * single static HTML file inline — no git repository, no per-business
 * Vercel project, compatible with the one existing VERCEL_PROJECT_ID.
 * https://vercel.com/docs/rest-api/reference/endpoints/deployments/create-a-new-deployment
 */
async function deployReal(input: DeployAdapterInput): Promise<DeployAdapterResult> {
  const token = getVercelToken();
  const projectId = getVercelProjectId();
  if (!token || !projectId) {
    throw new DeploymentError("MISSING_CREDENTIALS", "Vercel deployment credentials are missing.", false);
  }
  const orgId = getVercelOrgId();

  const url = new URL(`${VERCEL_API_BASE}/v13/deployments`);
  if (orgId) url.searchParams.set("teamId", orgId);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.deploymentName,
        project: projectId,
        target: "production",
        files: [{ file: "index.html", data: input.html, encoding: "utf-8" }],
        projectSettings: { framework: null },
      }),
    });
  } catch (err) {
    throw classifyVercelNetworkError(err);
  }

  if (!response.ok) {
    const requestId = response.headers.get("x-vercel-id");
    // Diagnostic only — never includes the Authorization header or token;
    // classifyVercelStatus itself only logs status + requestId, no body.
    throw classifyVercelStatus(response.status, requestId);
  }

  const data = (await response.json()) as { id?: string; url?: string; readyState?: string };
  if (!data.id || !data.url) {
    throw new DeploymentError("UNKNOWN", "Vercel deployment response was missing required fields.", false);
  }

  return {
    usedMock: false,
    deploymentId: data.id,
    deploymentUrl: `https://${data.url}`,
    status: mapReadyState(data.readyState),
  };
}

function mapReadyState(readyState: string | undefined): DeployAdapterStatus {
  if (readyState === "READY") return "READY";
  if (readyState === "ERROR" || readyState === "CANCELED") return "FAILED";
  return "BUILDING";
}

/**
 * Single entry point used by lib/demo/deploy-demo.ts. DEMO_MODE is
 * checked first (same rationale as lib/demo/generate-demo-content.ts):
 * it's the explicit dev-mode override, so no Vercel token is required —
 * or contacted — unless DEMO_MODE=false.
 */
export async function deployToVercel(input: DeployAdapterInput): Promise<DeployAdapterResult> {
  if (isDemoModeEnabled()) {
    return deployMock(input);
  }
  if (!isVercelConfigured()) {
    throw new DeploymentError("MISSING_CREDENTIALS", "Vercel deployment credentials are missing.", false);
  }
  return deployReal(input);
}
