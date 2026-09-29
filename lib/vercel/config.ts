/**
 * Centralized Vercel deployment configuration. Read from env so it can be
 * tuned without touching call sites — mirrors lib/ai/config.ts's shape.
 */
export function isVercelConfigured(): boolean {
  return Boolean(
    process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID
  );
}

/**
 * DEMO_MODE is checked before VERCEL_TOKEN presence, same rationale as
 * lib/demo/generate-demo-content.ts: it's the explicit dev-mode override,
 * so no Vercel deployment is ever attempted (and no token is required)
 * unless someone deliberately sets DEMO_MODE=false.
 */
export function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE !== "false";
}

export function getVercelToken(): string | undefined {
  return process.env.VERCEL_TOKEN;
}

export function getVercelOrgId(): string | undefined {
  return process.env.VERCEL_ORG_ID;
}

export function getVercelProjectId(): string | undefined {
  return process.env.VERCEL_PROJECT_ID;
}

export const VERCEL_API_BASE = "https://api.vercel.com";
export const VERCEL_PROVIDER = "vercel";
