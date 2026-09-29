import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/outreach/generate-outreach-content", () => ({
  generateOutreachContent: vi.fn(),
}));

const { createClient } = await import("@/lib/supabase/server");
const { generateOutreachContent } = await import("@/lib/outreach/generate-outreach-content");
const { generateOutreach, GenerateOutreachIneligibleError } = await import(
  "@/lib/outreach/generate-outreach"
);

let fake: FakeSupabase;

const ids = new Map<string, string>();
function uuid(label: string): string {
  if (!ids.has(label)) ids.set(label, randomUUID());
  return ids.get(label)!;
}

const VALID_COPY = {
  subject: "A free demo website for ABC Bakery",
  body: "Hi ABC Bakery team,\n\nWe built a demo for you.",
  cta: "Take a look",
  personalizationPoints: ["No online visibility"],
};

function seedPipeline(overrides: {
  businessId: string;
  leadId: string;
  email?: string | null;
  leadStatus?: string;
  qualificationStatus?: string;
  hasAnalysis?: boolean;
}) {
  fake._seed("businesses", [
    {
      id: overrides.businessId,
      business_name: "ABC Bakery",
      category: "Bakery",
      has_website: false,
      phone: "+919876543210",
      email: overrides.email === undefined ? "owner@abcbakery.example.com" : overrides.email,
      city: "Dindigul",
      state: "Tamil Nadu",
    },
  ]);
  fake._seed("leads", [
    {
      id: overrides.leadId,
      business_id: overrides.businessId,
      status: overrides.leadStatus ?? "DEMO_CREATED",
      qualification_status: overrides.qualificationStatus ?? "QUALIFIED",
      created_at: new Date().toISOString(),
    },
  ]);
  if (overrides.hasAnalysis !== false) {
    fake._seed("lead_analysis", [
      {
        id: randomUUID(),
        lead_id: overrides.leadId,
        business_summary: "A busy local bakery.",
        services: ["Custom cakes"],
        pain_points: ["No online visibility"],
        personalization_points: ["Mention fresh daily bread"],
        created_at: new Date().toISOString(),
      },
    ]);
  }
}

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(fake as never);
  vi.mocked(generateOutreachContent).mockReset();
  vi.mocked(generateOutreachContent).mockResolvedValue({
    data: VALID_COPY,
    usedMock: true,
    model: null,
    promptVersion: "v1",
    usage: null,
  });
});

describe("generateOutreach (eligibility)", () => {
  it("rejects an unknown lead id (unauthorized/nonexistent lead)", async () => {
    await expect(generateOutreach(randomUUID())).rejects.toThrow(GenerateOutreachIneligibleError);
    expect(generateOutreachContent).not.toHaveBeenCalled();
  });

  it("rejects a lead with a missing recipient email", async () => {
    seedPipeline({ businessId: uuid("b1"), leadId: uuid("l1"), email: null });
    await expect(generateOutreach(uuid("l1"))).rejects.toMatchObject({ code: "MISSING_EMAIL" });
    expect(generateOutreachContent).not.toHaveBeenCalled();
  });

  it("rejects a lead with an invalid recipient email", async () => {
    seedPipeline({ businessId: uuid("b2"), leadId: uuid("l2"), email: "not-an-email" });
    await expect(generateOutreach(uuid("l2"))).rejects.toMatchObject({ code: "MISSING_EMAIL" });
  });

  it("rejects a suppressed recipient", async () => {
    seedPipeline({ businessId: uuid("b3"), leadId: uuid("l3"), email: "suppressed@example.com" });
    fake._seed("suppression_list", [{ id: randomUUID(), email: "suppressed@example.com" }]);
    await expect(generateOutreach(uuid("l3"))).rejects.toMatchObject({ code: "SUPPRESSED" });
    expect(generateOutreachContent).not.toHaveBeenCalled();
  });

  it("rejects a lead that has not been qualified", async () => {
    seedPipeline({ businessId: uuid("b4"), leadId: uuid("l4"), qualificationStatus: "PENDING" });
    await expect(generateOutreach(uuid("l4"))).rejects.toMatchObject({ code: "NOT_QUALIFIED" });
  });

  it("rejects a DO_NOT_CONTACT lead", async () => {
    seedPipeline({ businessId: uuid("b5"), leadId: uuid("l5"), leadStatus: "DO_NOT_CONTACT" });
    await expect(generateOutreach(uuid("l5"))).rejects.toMatchObject({ code: "DO_NOT_CONTACT" });
  });

  it("rejects a qualified lead with no analysis yet", async () => {
    seedPipeline({ businessId: uuid("b6"), leadId: uuid("l6"), hasAnalysis: false });
    await expect(generateOutreach(uuid("l6"))).rejects.toMatchObject({ code: "ANALYSIS_MISSING" });
  });

  it("rejects generating a new draft when one is already SENT for this lead (duplicate protection)", async () => {
    seedPipeline({ businessId: uuid("b7"), leadId: uuid("l7") });
    fake._seed("outreach_messages", [
      {
        id: randomUUID(),
        lead_id: uuid("l7"),
        status: "SENT",
        recipient_email: "owner@abcbakery.example.com",
        created_at: new Date().toISOString(),
      },
    ]);
    await expect(generateOutreach(uuid("l7"))).rejects.toMatchObject({
      code: "DUPLICATE_ACTIVE_OUTREACH",
    });
    expect(generateOutreachContent).not.toHaveBeenCalled();
  });
});

describe("generateOutreach (success)", () => {
  it("creates a DRAFT outreach_messages row from only verified fields", async () => {
    seedPipeline({ businessId: uuid("b8"), leadId: uuid("l8") });

    const result = await generateOutreach(uuid("l8"));

    expect(result.alreadyGenerated).toBe(false);
    expect(result.status).toBe("DRAFT");
    expect(result.recipientEmail).toBe("owner@abcbakery.example.com");

    const messages = fake._dump()["outreach_messages"] as Array<{
      lead_id: string;
      status: string;
      recipient_email: string;
    }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe("DRAFT");
    expect(messages[0].lead_id).toBe(uuid("l8"));

    const call = vi.mocked(generateOutreachContent).mock.calls[0][0];
    expect(call.businessName).toBe("ABC Bakery");
    expect(call.demoUrl).toBeNull(); // no demo deployed in this scenario
  });

  it("is idempotent — a second call returns the existing DRAFT without regenerating", async () => {
    seedPipeline({ businessId: uuid("b9"), leadId: uuid("l9") });

    const first = await generateOutreach(uuid("l9"));
    expect(first.alreadyGenerated).toBe(false);
    expect(generateOutreachContent).toHaveBeenCalledTimes(1);

    const second = await generateOutreach(uuid("l9"));
    expect(second.alreadyGenerated).toBe(true);
    expect(second.messageId).toBe(first.messageId);
    expect(generateOutreachContent).toHaveBeenCalledTimes(1);

    const messages = fake._dump()["outreach_messages"] ?? [];
    expect(messages).toHaveLength(1);
  });

  it("includes the deployed demo URL when one exists and is READY", async () => {
    seedPipeline({ businessId: uuid("b10"), leadId: uuid("l10") });
    const demoId = randomUUID();
    fake._seed("demos", [{ id: demoId, lead_id: uuid("l10"), status: "DEPLOYED", created_at: new Date().toISOString() }]);
    fake._seed("demo_deployments", [
      {
        id: randomUUID(),
        demo_id: demoId,
        status: "READY",
        deployment_url: "https://abc-bakery.demo-mode.invalid",
        created_at: new Date().toISOString(),
      },
    ]);

    await generateOutreach(uuid("l10"));

    const call = vi.mocked(generateOutreachContent).mock.calls[0][0];
    expect(call.demoUrl).toBe("https://abc-bakery.demo-mode.invalid");
  });
});
