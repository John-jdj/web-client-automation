import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/outreach/generate-outreach", () => ({
  generateOutreach: vi.fn(),
  GenerateOutreachIneligibleError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/lib/outreach/review-outreach", () => ({
  approveOutreach: vi.fn(),
  rejectOutreach: vi.fn(),
  ReviewOutreachIneligibleError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/lib/outreach/send-outreach", () => ({
  sendOutreach: vi.fn(),
  SendOutreachIneligibleError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

const { createClient } = await import("@/lib/supabase/server");
const { generateOutreach } = await import("@/lib/outreach/generate-outreach");
const { approveOutreach, rejectOutreach } = await import("@/lib/outreach/review-outreach");
const { sendOutreach } = await import("@/lib/outreach/send-outreach");
const { POST: generateRoute } = await import("@/app/api/outreach/generate/route");
const { POST: approveRoute } = await import("@/app/api/outreach/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/outreach/[id]/reject/route");
const { POST: sendRoute } = await import("@/app/api/outreach/[id]/send/route");
const { POST: prepareBatchRoute } = await import("@/app/api/outreach/prepare-batch/route");

let fake: FakeSupabase;

function req(url: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function withParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(fake as never);
  vi.mocked(generateOutreach).mockReset();
  vi.mocked(approveOutreach).mockReset();
  vi.mocked(rejectOutreach).mockReset();
  vi.mocked(sendOutreach).mockReset();
});

describe("outreach routes (auth required)", () => {
  it("rejects an unauthenticated /api/outreach/generate request", async () => {
    fake._setUser(null);
    const response = await generateRoute(req("http://localhost/api/outreach/generate", { leadId: "x" }));
    expect(response.status).toBe(401);
    expect(generateOutreach).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated /api/outreach/[id]/approve request", async () => {
    fake._setUser(null);
    const response = await approveRoute(req("http://localhost/api/outreach/m1/approve"), withParams("m1"));
    expect(response.status).toBe(401);
    expect(approveOutreach).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated /api/outreach/[id]/reject request", async () => {
    fake._setUser(null);
    const response = await rejectRoute(req("http://localhost/api/outreach/m1/reject"), withParams("m1"));
    expect(response.status).toBe(401);
    expect(rejectOutreach).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated /api/outreach/[id]/send request", async () => {
    fake._setUser(null);
    const response = await sendRoute(req("http://localhost/api/outreach/m1/send"), withParams("m1"));
    expect(response.status).toBe(401);
    expect(sendOutreach).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated /api/outreach/prepare-batch request", async () => {
    fake._setUser(null);
    const response = await prepareBatchRoute(req("http://localhost/api/outreach/prepare-batch", { limit: 5 }));
    expect(response.status).toBe(401);
  });
});

describe("POST /api/outreach/generate (happy path + error mapping)", () => {
  it("returns the generated draft for an authenticated request", async () => {
    vi.mocked(generateOutreach).mockResolvedValue({
      alreadyGenerated: false,
      messageId: "m1",
      leadId: "l1",
      status: "DRAFT",
      recipientEmail: "owner@example.com",
      subject: "Subject",
      body: "Body",
      cta: "CTA",
      personalizationPoints: ["point"],
      demoUrl: null,
      usedMock: true,
    });

    const response = await generateRoute(
      req("http://localhost/api/outreach/generate", { leadId: "11111111-1111-4111-8111-111111111111" })
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("DRAFT");
  });

  it("rejects an invalid request body", async () => {
    const response = await generateRoute(req("http://localhost/api/outreach/generate", { leadId: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(generateOutreach).not.toHaveBeenCalled();
  });
});

describe("POST /api/outreach/prepare-batch (never sends, respects limit)", () => {
  function seedCandidateLeads(ids: string[]) {
    fake._seed(
      "leads",
      ids.map((id) => ({ id, qualification_status: "QUALIFIED", status: "DEMO_CREATED", created_at: new Date().toISOString() }))
    );
  }

  it("prepares drafts without ever calling sendOutreach", async () => {
    seedCandidateLeads(["lead1", "lead2", "lead3"]);
    vi.mocked(generateOutreach).mockImplementation(async (leadId: string) => ({
      alreadyGenerated: false,
      messageId: `msg_${leadId}`,
      leadId,
      status: "DRAFT",
      recipientEmail: "owner@example.com",
      subject: "s",
      body: "b",
      cta: "c",
      personalizationPoints: [],
      demoUrl: null,
      usedMock: true,
    }));

    const response = await prepareBatchRoute(req("http://localhost/api/outreach/prepare-batch", { limit: 10 }));
    const body = await response.json();

    expect(body.summary.prepared).toBe(3);
    expect(sendOutreach).not.toHaveBeenCalled();
  });

  it("respects the requested batch limit", async () => {
    seedCandidateLeads(["lead4", "lead5", "lead6", "lead7"]);
    vi.mocked(generateOutreach).mockImplementation(async (leadId: string) => ({
      alreadyGenerated: false,
      messageId: `msg_${leadId}`,
      leadId,
      status: "DRAFT",
      recipientEmail: "owner@example.com",
      subject: "s",
      body: "b",
      cta: "c",
      personalizationPoints: [],
      demoUrl: null,
      usedMock: true,
    }));

    const response = await prepareBatchRoute(req("http://localhost/api/outreach/prepare-batch", { limit: 2 }));
    const body = await response.json();

    expect(body.summary.prepared).toBe(2);
    expect(generateOutreach).toHaveBeenCalledTimes(2);
  });

  it("reports skipped/failed leads without aborting the batch", async () => {
    const { GenerateOutreachIneligibleError } = await import("@/lib/outreach/generate-outreach");
    seedCandidateLeads(["lead8", "lead9"]);
    vi.mocked(generateOutreach).mockImplementation(async (leadId: string) => {
      if (leadId === "lead8") {
        throw new GenerateOutreachIneligibleError("MISSING_EMAIL", "No recipient email.");
      }
      return {
        alreadyGenerated: false,
        messageId: "msg_lead9",
        leadId,
        status: "DRAFT",
        recipientEmail: "owner@example.com",
        subject: "s",
        body: "b",
        cta: "c",
        personalizationPoints: [],
        demoUrl: null,
        usedMock: true,
      };
    });

    const response = await prepareBatchRoute(req("http://localhost/api/outreach/prepare-batch", { limit: 10 }));
    const body = await response.json();

    expect(body.summary.skipped).toBe(1);
    expect(body.summary.prepared).toBe(1);
  });
});

// POST /api/outreach/unsubscribe now takes a signed token, not a raw
// email — see tests/outreach-unsubscribe.test.ts for its full coverage
// (it needs its own createServiceClient mock and DEMO_MODE control).
