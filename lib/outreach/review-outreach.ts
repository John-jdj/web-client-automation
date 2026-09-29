import "server-only";
import { getLead } from "@/lib/db/leads";
import { getOutreachMessage, updateOutreachMessage, type OutreachMessage } from "@/lib/db/outreach";

export type ReviewOutreachIneligibleCode = "MESSAGE_NOT_FOUND" | "LEAD_NOT_FOUND" | "NOT_A_DRAFT";

export class ReviewOutreachIneligibleError extends Error {
  code: ReviewOutreachIneligibleCode;
  constructor(code: ReviewOutreachIneligibleCode, message: string) {
    super(message);
    this.name = "ReviewOutreachIneligibleError";
    this.code = code;
  }
}

/**
 * Loads a message and confirms it's visible to the caller (RLS-scoped
 * `createClient()` reads via getLead — an unauthorized user sees nothing,
 * same pattern as lib/demo/deploy-demo.ts) before either review action.
 */
async function loadAuthorizedDraft(id: string): Promise<OutreachMessage> {
  const message = await getOutreachMessage(id);
  if (!message) {
    throw new ReviewOutreachIneligibleError("MESSAGE_NOT_FOUND", "Outreach message not found.");
  }
  const lead = await getLead(message.lead_id);
  if (!lead) {
    throw new ReviewOutreachIneligibleError("LEAD_NOT_FOUND", "Lead not found for this outreach message.");
  }
  if (message.status !== "DRAFT") {
    throw new ReviewOutreachIneligibleError(
      "NOT_A_DRAFT",
      `Only a DRAFT message can be reviewed — this one is ${message.status}.`
    );
  }
  return message;
}

/**
 * Approves a draft. The outreach_messages schema has no distinct
 * "APPROVED" status value (its check constraint only allows DRAFT,
 * PENDING_APPROVAL, QUEUED, SENDING, SENT, FAILED, BOUNCED, REPLIED,
 * CANCELLED) — QUEUED is used as this schema's "approved, ready to send"
 * state, since that's exactly what it means here: approved and eligible
 * to be picked up by the send step next.
 */
export async function approveOutreach(id: string): Promise<OutreachMessage> {
  const message = await loadAuthorizedDraft(id);
  return updateOutreachMessage(message.id, { status: "QUEUED" });
}

/** Rejects a draft — CANCELLED is the existing status closest to "withdrawn, will not be sent". */
export async function rejectOutreach(id: string): Promise<OutreachMessage> {
  const message = await loadAuthorizedDraft(id);
  return updateOutreachMessage(message.id, { status: "CANCELLED" });
}
