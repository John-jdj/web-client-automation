import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));

const { createServiceClient } = await import("@/lib/supabase/service");
const { signUnsubscribeToken } = await import("@/lib/outreach/unsubscribe-token");
const { GET, POST } = await import("@/app/api/outreach/unsubscribe/route");

let fake: FakeSupabase;

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createServiceClient).mockReturnValue(fake as never);
});

function seedMessage(id: string, email: string | null = "owner@example.com") {
  fake._seed("outreach_messages", [
    { id, lead_id: "lead1", status: "SENT", recipient_email: email, created_at: new Date().toISOString() },
  ]);
}

function getReq(token: string) {
  return new Request(`http://localhost/api/outreach/unsubscribe?token=${encodeURIComponent(token)}`);
}

function postReq(body: unknown) {
  return new Request("http://localhost/api/outreach/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /api/outreach/unsubscribe", () => {
  it("succeeds for a valid token and returns a safe HTML confirmation page", async () => {
    seedMessage("m1");
    const token = signUnsubscribeToken("m1");

    const response = await GET(getReq(token));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");

    const html = await response.text();
    expect(html.toLowerCase()).toContain("unsubscribed");
    // No CRM/lead/business detail leakage into the public page.
    expect(html).not.toMatch(/lead1|owner@example\.com|SENT/);
  });

  it("returns a generic invalid-link page for a garbage token", async () => {
    const response = await GET(getReq("garbage-not-a-real-token"));
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html.toLowerCase()).toContain("invalid");
  });

  it("returns a generic invalid-link page when no token is supplied at all", async () => {
    const response = await GET(new Request("http://localhost/api/outreach/unsubscribe"));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/outreach/unsubscribe", () => {
  it("succeeds for a valid token", async () => {
    seedMessage("m2");
    const token = signUnsubscribeToken("m2");

    const response = await POST(postReq({ token }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("rejects a request with no token", async () => {
    const response = await POST(postReq({}));
    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(postReq("not json"));
    expect(response.status).toBe(400);
  });
});

describe("unsubscribe behavior (no arbitrary email, idempotent, add-only)", () => {
  it("suppresses exactly the recipient the token was signed for, ignoring any other field in the request", async () => {
    seedMessage("m3", "real-recipient@example.com");
    const token = signUnsubscribeToken("m3");

    // A caller tries to smuggle a different email alongside a valid token.
    const response = await POST(postReq({ token, email: "attacker-chosen@example.com" }));
    expect(response.status).toBe(200);

    const suppressed = fake._dump()["suppression_list"] as Array<{ email: string }>;
    expect(suppressed.some((s) => s.email === "real-recipient@example.com")).toBe(true);
    expect(suppressed.some((s) => s.email === "attacker-chosen@example.com")).toBe(false);
  });

  it("is idempotent — the same link clicked twice suppresses only once", async () => {
    seedMessage("m4", "repeat@example.com");
    const token = signUnsubscribeToken("m4");

    const first = await GET(getReq(token));
    const second = await GET(getReq(token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const suppressed = fake._dump()["suppression_list"] as Array<{ email: string }>;
    expect(suppressed.filter((s) => s.email === "repeat@example.com")).toHaveLength(1);
  });

  it("never reveals whether the recipient was already suppressed, and never removes an existing entry", async () => {
    seedMessage("m5", "already-suppressed@example.com");
    fake._seed("suppression_list", [
      { id: "sup1", email: "already-suppressed@example.com", reason: "prior manual suppression" },
    ]);
    const token = signUnsubscribeToken("m5");

    const response = await GET(getReq(token));
    expect(response.status).toBe(200); // identical response whether or not it was already suppressed

    const suppressed = fake._dump()["suppression_list"] as Array<{ email: string; reason: string | null }>;
    const entries = suppressed.filter((s) => s.email === "already-suppressed@example.com");
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("prior manual suppression"); // untouched, not overwritten or removed
  });

  it("rejects a token for a message with no recipient email, without leaking why", async () => {
    seedMessage("m6", null);
    const token = signUnsubscribeToken("m6");
    const response = await GET(getReq(token));
    expect(response.status).toBe(400);
  });

  it("rejects a token pointing at a message id that doesn't exist", async () => {
    const token = signUnsubscribeToken("11111111-1111-4111-8111-000000000000");
    const response = await GET(getReq(token));
    expect(response.status).toBe(400);
  });
});

describe("no secret leakage", () => {
  it("never logs or returns OUTREACH_UNSUBSCRIBE_SECRET, even on a failure path", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(getReq("garbage"));
    const html = await response.text();

    expect(html).not.toMatch(/OUTREACH_UNSUBSCRIBE_SECRET/i);
    for (const call of consoleSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/OUTREACH_UNSUBSCRIBE_SECRET/i);
    }
  });
});
