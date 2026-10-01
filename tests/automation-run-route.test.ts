import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/automation/run-automation", async () => {
  class AutomationAlreadyRunningError extends Error {
    constructor(public runId: string) {
      super(`Automation is already running (run ${runId}).`);
      this.name = "AutomationAlreadyRunningError";
    }
  }
  return {
    runAutomation: vi.fn(),
    AutomationAlreadyRunningError,
  };
});

const { runAutomation, AutomationAlreadyRunningError } = await import("@/lib/automation/run-automation");
const { POST, GET, PUT, PATCH, DELETE } = await import("@/app/api/automation/run/route");

const ORIGINAL_ENV = { ...process.env };
const REAL_SECRET = "a-real-cron-secret-value-for-tests";

function req(headers?: Record<string, string>, method: string = "POST") {
  return new Request("http://localhost/api/automation/run", {
    method,
    headers,
  });
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, AUTOMATION_CRON_SECRET: REAL_SECRET };
  vi.mocked(runAutomation).mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("POST /api/automation/run (happy path)", () => {
  it("executes runAutomation for a correctly authenticated request", async () => {
    vi.mocked(runAutomation).mockResolvedValue({
      runId: "run-1",
      status: "COMPLETED",
      steps: [{ step: "lead_analysis", status: "COMPLETED", summary: { qualifiedLeads: 2 } }],
    });

    const response = await POST(req({ Authorization: `Bearer ${REAL_SECRET}` }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runId).toBe("run-1");
    expect(body.status).toBe("COMPLETED");
    expect(runAutomation).toHaveBeenCalledTimes(1);
  });

  it("sets Cache-Control: no-store and a JSON content type", async () => {
    vi.mocked(runAutomation).mockResolvedValue({ runId: "run-1", status: "COMPLETED", steps: [] });

    const response = await POST(req({ Authorization: `Bearer ${REAL_SECRET}` }));

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("never puts the cron secret in a response header", async () => {
    vi.mocked(runAutomation).mockResolvedValue({ runId: "run-1", status: "COMPLETED", steps: [] });

    const response = await POST(req({ Authorization: `Bearer ${REAL_SECRET}` }));

    for (const [, value] of response.headers.entries()) {
      expect(value).not.toContain(REAL_SECRET);
    }
  });
});

describe("POST /api/automation/run (authentication)", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await POST(req());
    expect(response.status).toBe(401);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("rejects a malformed Authorization header (wrong scheme)", async () => {
    const response = await POST(req({ Authorization: `Basic ${REAL_SECRET}` }));
    expect(response.status).toBe(401);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("rejects a malformed Authorization header (Bearer with no token)", async () => {
    const response = await POST(req({ Authorization: "Bearer" }));
    expect(response.status).toBe(401);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("rejects a malformed Authorization header (Bearer with only whitespace)", async () => {
    const response = await POST(req({ Authorization: "Bearer    " }));
    expect(response.status).toBe(401);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("rejects the wrong secret (same length as the real one)", async () => {
    const sameLengthWrong = "b".repeat(REAL_SECRET.length);
    const response = await POST(req({ Authorization: `Bearer ${sameLengthWrong}` }));
    expect(response.status).toBe(401);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("rejects the wrong secret (different length than the real one)", async () => {
    const response = await POST(req({ Authorization: "Bearer too-short" }));
    expect(response.status).toBe(401);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("never reveals which part of the request was wrong — same generic message/status for every failure mode", async () => {
    const noHeader = await POST(req());
    const badScheme = await POST(req({ Authorization: "Token xyz" }));
    const wrongSecret = await POST(req({ Authorization: "Bearer wrong-value-entirely" }));

    const bodies = await Promise.all([noHeader.json(), badScheme.json(), wrongSecret.json()]);
    expect(noHeader.status).toBe(401);
    expect(badScheme.status).toBe(401);
    expect(wrongSecret.status).toBe(401);
    expect(new Set(bodies.map((b) => b.error)).size).toBe(1); // identical message every time
  });

  it("never echoes the supplied (wrong) secret back in the response", async () => {
    const suppliedSecret = "this-is-the-wrong-secret-abc123";
    const response = await POST(req({ Authorization: `Bearer ${suppliedSecret}` }));
    const text = await response.text();
    expect(text).not.toContain(suppliedSecret);
  });

  it("accepts the exact configured secret and nothing else (functional proof the comparator is correct, not just 'truthy')", async () => {
    vi.mocked(runAutomation).mockResolvedValue({ runId: "r", status: "COMPLETED", steps: [] });
    const ok = await POST(req({ Authorization: `Bearer ${REAL_SECRET}` }));
    expect(ok.status).toBe(200);

    vi.mocked(runAutomation).mockClear();
    const almostRight = await POST(req({ Authorization: `Bearer ${REAL_SECRET}x` }));
    expect(almostRight.status).toBe(401);
    expect(runAutomation).not.toHaveBeenCalled();
  });
});

describe("POST /api/automation/run (fail closed on missing configuration)", () => {
  it("returns 500 and never runs automation when AUTOMATION_CRON_SECRET is not set", async () => {
    delete process.env.AUTOMATION_CRON_SECRET;

    const response = await POST(req({ Authorization: `Bearer ${REAL_SECRET}` }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("returns 500 (not 401) specifically when the secret is unconfigured, even with no Authorization header at all", async () => {
    delete process.env.AUTOMATION_CRON_SECRET;
    const response = await POST(req());
    expect(response.status).toBe(500);
  });
});

describe("POST /api/automation/run (error mapping)", () => {
  it("maps AutomationAlreadyRunningError to 409", async () => {
    vi.mocked(runAutomation).mockRejectedValue(new AutomationAlreadyRunningError("run-existing"));

    const response = await POST(req({ Authorization: `Bearer ${REAL_SECRET}` }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
  });

  it("maps an unexpected runner error to a safe 500 with no stack trace or internals", async () => {
    vi.mocked(runAutomation).mockRejectedValue(new Error("relation \"leads\" does not exist: raw db detail"));

    const response = await POST(req({ Authorization: `Bearer ${REAL_SECRET}` }));
    const body = await response.json();
    const text = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(text).not.toContain("raw db detail");
    expect(text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/); // no stack-trace-shaped content
  });
});

describe("GET /api/automation/run (Vercel Cron's invocation method — Step 11.5)", () => {
  // Vercel Cron Jobs always invoke the scheduled path with GET — there is
  // no way to configure Vercel's scheduler to send POST. GET must
  // therefore be authenticated and behave identically to POST, not be a
  // separate, lesser-checked path.
  it("executes runAutomation for a correctly authenticated GET request, just like POST", async () => {
    vi.mocked(runAutomation).mockResolvedValue({
      runId: "run-1",
      status: "COMPLETED",
      steps: [{ step: "lead_analysis", status: "COMPLETED", summary: { qualifiedLeads: 2 } }],
    });

    const response = await GET(req({ Authorization: `Bearer ${REAL_SECRET}` }, "GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runId).toBe("run-1");
    expect(runAutomation).toHaveBeenCalledTimes(1);
  });

  it("rejects a GET request with no Authorization header (401, not a free pass)", async () => {
    const response = await GET(req(undefined, "GET"));
    expect(response.status).toBe(401);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("rejects a GET request with the wrong secret", async () => {
    const response = await GET(req({ Authorization: "Bearer wrong-value-entirely" }, "GET"));
    expect(response.status).toBe(401);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("fails closed (500) on GET too when AUTOMATION_CRON_SECRET is unconfigured", async () => {
    delete process.env.AUTOMATION_CRON_SECRET;
    const response = await GET(req({ Authorization: `Bearer ${REAL_SECRET}` }, "GET"));
    expect(response.status).toBe(500);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("maps AutomationAlreadyRunningError to 409 on GET too", async () => {
    vi.mocked(runAutomation).mockRejectedValue(new AutomationAlreadyRunningError("run-existing"));
    const response = await GET(req({ Authorization: `Bearer ${REAL_SECRET}` }, "GET"));
    expect(response.status).toBe(409);
  });
});

describe("Method restrictions", () => {
  it("PUT, PATCH, and DELETE return 405 and list GET, POST as the allowed methods", async () => {
    for (const handler of [PUT, PATCH, DELETE]) {
      const response = await handler();
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, POST");
    }
    expect(runAutomation).not.toHaveBeenCalled();
  });
});

describe("no secret leakage in the response body", () => {
  it("a successful run's response never contains the cron secret or a service-role-shaped key", async () => {
    vi.mocked(runAutomation).mockResolvedValue({
      runId: "run-1",
      status: "COMPLETED",
      steps: [{ step: "discovery", status: "SKIPPED", reason: "no location/category supplied for this run", summary: {} }],
    });

    const response = await POST(req({ Authorization: `Bearer ${REAL_SECRET}` }));
    const text = await response.text();

    expect(text).not.toContain(REAL_SECRET);
    expect(text).not.toMatch(/SUPABASE_SECRET_KEY|AUTOMATION_CRON_SECRET|service_role/i);
  });
});

describe("route never calls sendOutreach or touches CRM tables directly (static safety guard)", () => {
  it("the route source only ever calls runAutomation — no sendOutreach, no direct Supabase table access", () => {
    const source = readFileSync(new URL("../app/api/automation/run/route.ts", import.meta.url), "utf-8");
    expect(source).not.toMatch(/sendOutreach\(/);
    expect(source).not.toMatch(/import\s*\{[^}]*sendOutreach/);
    expect(source).not.toMatch(/\.from\(["'](leads|demos|outreach_messages|businesses)["']\)/);
  });
});
