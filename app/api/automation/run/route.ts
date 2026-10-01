import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runAutomation, AutomationAlreadyRunningError } from "@/lib/automation/run-automation";

/**
 * Step 11.3 — the endpoint a trusted cloud scheduler calls. It is a thin,
 * authenticated trigger: it does nothing but verify the caller and call
 * `runAutomation()` (lib/automation/run-automation.ts), which is where
 * every actual safety control lives (automation_settings.enabled,
 * per-step flags, DEMO_MODE, daily limits, suppression, approval,
 * idempotency, job claiming, retries, error/audit logging). This route
 * adds no business logic of its own, and — like runAutomation() itself —
 * never imports or calls sendOutreach, so it cannot send email no matter
 * what automation_settings says.
 *
 * Step 11.5 — both GET and POST are accepted with identical behavior.
 * This isn't a REST relaxation for its own sake: Vercel Cron Jobs
 * (configured in vercel.json, see that file's comment) always invoke the
 * scheduled path with a GET request — there is no way to configure
 * Vercel's scheduler to send POST. GET is authenticated exactly like
 * POST (the same constant-time Authorization: Bearer check, the same
 * fail-closed-on-missing-config behavior) — it is not a lesser-privileged
 * or unauthenticated path, it is the same trigger reachable by a second
 * HTTP method so the one real caller (Vercel's scheduler) can actually
 * reach it. PUT/PATCH/DELETE remain disallowed.
 */

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status: number, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE_HEADERS, ...extraHeaders } });
}

function methodNotAllowed() {
  return json(
    { success: false, error: "Method not allowed." },
    405,
    { Allow: "GET, POST" }
  );
}

/** `null` means "not configured" — callers must fail closed on that, distinctly from "wrong secret". */
function getConfiguredSecret(): string | null {
  const secret = process.env.AUTOMATION_CRON_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

/** Only the `Authorization: Bearer <token>` header — never query params, body, cookies, or the URL path. */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/.exec(header);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Constant-time comparison (node:crypto's `timingSafeEqual`) — a plain
 * `===`/string comparison would let an attacker recover the secret one
 * byte at a time by measuring response latency. `timingSafeEqual` itself
 * requires equal-length buffers (it throws otherwise), so a length
 * mismatch is handled explicitly below, including still performing a
 * same-cost dummy comparison so a request with the wrong length doesn't
 * return measurably faster than one with the right length but wrong
 * content.
 */
function isAuthorized(request: Request, configuredSecret: string): boolean {
  const supplied = extractBearerToken(request);
  if (!supplied) return false;

  const suppliedBuf = Buffer.from(supplied);
  const configuredBuf = Buffer.from(configuredSecret);

  if (suppliedBuf.length !== configuredBuf.length) {
    timingSafeEqual(suppliedBuf, suppliedBuf); // same-cost no-op, avoids a length-based timing shortcut
    return false;
  }
  return timingSafeEqual(suppliedBuf, configuredBuf);
}

async function handleTriggerRequest(request: Request) {
  const configuredSecret = getConfiguredSecret();
  if (!configuredSecret) {
    // Fail closed: never run automation just because the secret wasn't
    // set up. Server-side log only — never the (nonexistent) value.
    console.error("[automation/run] AUTOMATION_CRON_SECRET is not configured; refusing to run automation.");
    return json({ success: false, error: "Server configuration error." }, 500);
  }

  if (!isAuthorized(request, configuredSecret)) {
    // Deliberately generic — never states whether the header was
    // missing, malformed, or simply wrong, and the supplied value is
    // never logged or echoed back.
    return json({ success: false, error: "Unauthorized." }, 401);
  }

  try {
    const result = await runAutomation();
    return json({ success: true, ...result }, 200);
  } catch (err) {
    if (err instanceof AutomationAlreadyRunningError) {
      return json({ success: false, error: "Automation is already running.", code: "ALREADY_RUNNING" }, 409);
    }
    // Never the raw error/stack — runAutomation() already logs the real
    // detail (safely) to error_logs/automation_runs itself.
    console.error("Automation run failed:", err);
    return json({ success: false, error: "Automation run failed unexpectedly." }, 500);
  }
}

export async function POST(request: Request) {
  return handleTriggerRequest(request);
}

/** Vercel Cron's own invocation method — see the file-level comment. Same auth, same behavior as POST. */
export async function GET(request: Request) {
  return handleTriggerRequest(request);
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
