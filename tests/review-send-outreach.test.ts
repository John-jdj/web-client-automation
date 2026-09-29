import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/email/send-email", () => ({
  sendEmail: vi.fn(),
}));

const { createClient } = await import("@/lib/supabase/server");
const { sendEmail } = await import("@/lib/email/send-email");
const { approveOutreach, rejectOutreach, ReviewOutreachIneligibleError } = await import(
  "@/lib/outreach/review-outreach"
);
const { sendOutreach } = await import("@/lib/outreach/send-outreach");
const { EmailProviderError } = await import("@/lib/email/errors");

let fake: FakeSupabase;

const ids = new Map<string, string>();
function uuid(label: string): string {
  if (!ids.has(label)) ids.set(label, randomUUID());
  return ids.get(label)!;
}

function seedSettings(
  overrides: Partial<{
    auto_outreach_enabled: boolean;
    require_outreach_approval: boolean;
    daily_outreach_limit: number;
  }> = {}
) {
  fake._seed("automation_settings", [
    {
      id: "settings_1",
      auto_outreach_enabled: false,
      require_outreach_approval: true,
      daily_outreach_limit: 10,
      ...overrides,
    },
  ]);
}

function seedMessage(overrides: {
  messageId: string;
  leadId: string;
  businessId: string;
  status?: string;
  recipientEmail?: string | null;
}) {
  fake._seed("businesses", [
    { id: overrides.businessId, business_name: "ABC Bakery", phone: "+919876543210" },
  ]);
  fake._seed("leads", [{ id: overrides.leadId, business_id: overrides.businessId, status: "DEMO_CREATED" }]);
  fake._seed("outreach_messages", [
    {
      id: overrides.messageId,
      lead_id: overrides.leadId,
      status: overrides.status ?? "DRAFT",
      recipient_email: overrides.recipientEmail === undefined ? "owner@abcbakery.example.com" : overrides.recipientEmail,
      subject: "A free demo website for ABC Bakery",
      message_body: "Hi ABC Bakery team,\n\nWe built a demo for you.",
      attempt_count: 0,
      created_at: new Date().toISOString(),
    },
  ]);
}

const MOCK_SEND_RESULT = { usedMock: true, simulated: true, providerMessageId: "mock_email_abc" };

beforeEach(() => {
  fake = createFakeSupabase();
  vi.mocked(createClient).mockResolvedValue(fake as never);
  vi.mocked(sendEmail).mockReset();
});

describe("approveOutreach / rejectOutreach", () => {
  it("approves a DRAFT — moves it to QUEUED (this schema's 'approved' state)", async () => {
    seedMessage({ messageId: uuid("m1"), leadId: uuid("l1"), businessId: uuid("b1") });
    const updated = await approveOutreach(uuid("m1"));
    expect(updated.status).toBe("QUEUED");
  });

  it("rejects a DRAFT — moves it to CANCELLED", async () => {
    seedMessage({ messageId: uuid("m2"), leadId: uuid("l2"), businessId: uuid("b2") });
    const updated = await rejectOutreach(uuid("m2"));
    expect(updated.status).toBe("CANCELLED");
  });

  it("refuses to approve a message that is not a DRAFT", async () => {
    seedMessage({ messageId: uuid("m3"), leadId: uuid("l3"), businessId: uuid("b3"), status: "SENT" });
    await expect(approveOutreach(uuid("m3"))).rejects.toThrow(ReviewOutreachIneligibleError);
  });

  it("refuses to reject a message that is not a DRAFT", async () => {
    seedMessage({ messageId: uuid("m4"), leadId: uuid("l4"), businessId: uuid("b4"), status: "QUEUED" });
    await expect(rejectOutreach(uuid("m4"))).rejects.toThrow(ReviewOutreachIneligibleError);
  });

  it("rejects acting on an unknown message id", async () => {
    await expect(approveOutreach(randomUUID())).rejects.toThrow(ReviewOutreachIneligibleError);
  });
});

describe("sendOutreach (approval + auto-outreach gating)", () => {
  it("refuses to send an unapproved DRAFT when approval is required", async () => {
    seedSettings({ auto_outreach_enabled: true, require_outreach_approval: true });
    seedMessage({ messageId: uuid("m5"), leadId: uuid("l5"), businessId: uuid("b5"), status: "DRAFT" });

    await expect(sendOutreach(uuid("m5"))).rejects.toMatchObject({ code: "NOT_APPROVED" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses to send when auto_outreach_enabled is false, even if approved", async () => {
    seedSettings({ auto_outreach_enabled: false });
    seedMessage({ messageId: uuid("m6"), leadId: uuid("l6"), businessId: uuid("b6"), status: "QUEUED" });

    await expect(sendOutreach(uuid("m6"))).rejects.toMatchObject({ code: "AUTO_OUTREACH_DISABLED" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("allows sending a DRAFT directly when require_outreach_approval is explicitly false", async () => {
    seedSettings({ auto_outreach_enabled: true, require_outreach_approval: false });
    seedMessage({ messageId: uuid("m7"), leadId: uuid("l7"), businessId: uuid("b7"), status: "DRAFT" });
    vi.mocked(sendEmail).mockResolvedValue(MOCK_SEND_RESULT);

    const result = await sendOutreach(uuid("m7"));
    expect(result.status).toBe("SENT");
  });
});

describe("sendOutreach (DEMO_MODE successful send)", () => {
  it("sends an approved message, records SENT + provider id, and logs usage — no real network call made here (sendEmail is mocked)", async () => {
    seedSettings({ auto_outreach_enabled: true });
    seedMessage({ messageId: uuid("m8"), leadId: uuid("l8"), businessId: uuid("b8"), status: "QUEUED" });
    vi.mocked(sendEmail).mockResolvedValue(MOCK_SEND_RESULT);

    const result = await sendOutreach(uuid("m8"));

    expect(result.status).toBe("SENT");
    expect(result.providerMessageId).toBe("mock_email_abc");
    expect(result.usedMock).toBe(true);

    const messages = fake._dump()["outreach_messages"] as Array<{
      id: string;
      status: string;
      sent_at: string | null;
    }>;
    const stored = messages.find((m) => m.id === uuid("m8"));
    expect(stored?.status).toBe("SENT");
    expect(stored?.sent_at).toBeTruthy();

    const usage = fake._dump()["api_usage"] as Array<{ provider: string; operation: string }>;
    expect(usage).toHaveLength(1);
    expect(usage[0].provider).toBe("email");
    expect(usage[0].operation).toBe("outreach_send");

    const events = fake._dump()["outreach_events"] as Array<{ event_type: string }>;
    expect(events.some((e) => e.event_type === "SENT")).toBe(true);
  });
});

describe("sendOutreach (safety blockers re-checked at send time)", () => {
  it("cancels and refuses to send when the recipient became suppressed after approval", async () => {
    seedSettings({ auto_outreach_enabled: true });
    seedMessage({ messageId: uuid("m9"), leadId: uuid("l9"), businessId: uuid("b9"), status: "QUEUED" });
    fake._seed("suppression_list", [{ id: randomUUID(), email: "owner@abcbakery.example.com" }]);

    await expect(sendOutreach(uuid("m9"))).rejects.toMatchObject({ code: "SUPPRESSED" });
    expect(sendEmail).not.toHaveBeenCalled();

    const messages = fake._dump()["outreach_messages"] as Array<{ id: string; status: string }>;
    expect(messages.find((m) => m.id === uuid("m9"))?.status).toBe("CANCELLED");
  });

  it("refuses to send with a missing recipient email", async () => {
    seedSettings({ auto_outreach_enabled: true });
    seedMessage({ messageId: uuid("m10"), leadId: uuid("l10"), businessId: uuid("b10"), status: "QUEUED", recipientEmail: null });

    await expect(sendOutreach(uuid("m10"))).rejects.toMatchObject({ code: "MISSING_EMAIL" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses to send a duplicate when another message for the same lead is already SENT", async () => {
    seedSettings({ auto_outreach_enabled: true });
    seedMessage({ messageId: uuid("m11"), leadId: uuid("l11"), businessId: uuid("b11"), status: "QUEUED" });
    fake._seed("outreach_messages", [
      {
        id: randomUUID(),
        lead_id: uuid("l11"),
        status: "SENT",
        recipient_email: "owner@abcbakery.example.com",
        created_at: new Date().toISOString(),
      },
    ]);

    await expect(sendOutreach(uuid("m11"))).rejects.toMatchObject({ code: "DUPLICATE_ACTIVE_OUTREACH" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("enforces the daily outreach limit", async () => {
    seedSettings({ auto_outreach_enabled: true, daily_outreach_limit: 1 });
    seedMessage({ messageId: uuid("m12"), leadId: uuid("l12"), businessId: uuid("b12"), status: "QUEUED" });
    fake._seed("api_usage", [
      { id: randomUUID(), provider: "email", operation: "outreach_send", created_at: new Date().toISOString() },
    ]);

    await expect(sendOutreach(uuid("m12"))).rejects.toMatchObject({ code: "DAILY_LIMIT_REACHED" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("sendOutreach (provider failure)", () => {
  it("becomes FAILED and throws when every attempt fails", async () => {
    seedSettings({ auto_outreach_enabled: true });
    seedMessage({ messageId: uuid("m13"), leadId: uuid("l13"), businessId: uuid("b13"), status: "QUEUED" });
    vi.mocked(sendEmail).mockRejectedValue(
      new EmailProviderError("UPSTREAM_UNAVAILABLE", "Email provider is temporarily unavailable.", true)
    );

    await expect(sendOutreach(uuid("m13"))).rejects.toThrow(EmailProviderError);
    expect(sendEmail).toHaveBeenCalledTimes(2); // one retry, retryable error

    const messages = fake._dump()["outreach_messages"] as Array<{ id: string; status: string; error_message: string | null }>;
    const stored = messages.find((m) => m.id === uuid("m13"));
    expect(stored?.status).toBe("FAILED");
    expect(stored?.error_message).toBe("Email provider is temporarily unavailable.");

    const errorLogs = fake._dump()["error_logs"] ?? [];
    expect(errorLogs).toHaveLength(1);
  });

  it("never leaks provider credentials in the persisted error message", async () => {
    seedSettings({ auto_outreach_enabled: true });
    seedMessage({ messageId: uuid("m14"), leadId: uuid("l14"), businessId: uuid("b14"), status: "QUEUED" });
    vi.mocked(sendEmail).mockRejectedValue(
      new EmailProviderError("AUTH_FAILED", "Email provider authentication failed.", false)
    );

    await expect(sendOutreach(uuid("m14"))).rejects.toThrow(EmailProviderError);

    const messages = fake._dump()["outreach_messages"] as Array<{ id: string; error_message: string | null }>;
    const stored = messages.find((m) => m.id === uuid("m14"));
    expect(stored?.error_message).not.toMatch(/RESEND_API_KEY|Bearer /i);
  });
});
