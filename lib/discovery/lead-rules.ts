import type { LeadStatus } from "@/lib/supabase/database.types";

export const TERMINAL_LEAD_STATUSES: LeadStatus[] = [
  "CONVERTED",
  "LOST",
  "DISQUALIFIED",
  "DO_NOT_CONTACT",
];

/**
 * Pure lead-creation rule, independent of the database so it's directly
 * unit-testable. `existingLeadStatus` is the business's most recent lead
 * status, or null if it has none yet.
 *
 *  - Never create a lead for a business that already has a website.
 *  - Never (re)create a lead once a business is DO_NOT_CONTACT.
 *  - Never create a second lead while one is still active (non-terminal) —
 *    this mirrors the `leads_one_active_per_business` DB constraint.
 *  - A new lead is allowed after a prior one reached a terminal state
 *    other than DO_NOT_CONTACT (e.g. LOST), so a business can be
 *    rediscovered and re-attempted later.
 */
export function shouldCreateLead(
  hasWebsite: boolean,
  existingLeadStatus: LeadStatus | null
): boolean {
  if (hasWebsite) return false;
  if (existingLeadStatus === null) return true;
  if (existingLeadStatus === "DO_NOT_CONTACT") return false;
  return TERMINAL_LEAD_STATUSES.includes(existingLeadStatus);
}

export interface LeadDecisionInput {
  hasWebsite: boolean;
  existingLeadStatus: LeadStatus | null;
  suppressed: boolean;
}

/**
 * Combines `shouldCreateLead` with suppression-list protection. A
 * suppressed business (present in `suppression_list`) must never receive a
 * new outreach-eligible lead, regardless of what the base rule says — it
 * can still appear in discovery results, just without a lead.
 */
export function resolveLeadDecision({
  hasWebsite,
  existingLeadStatus,
  suppressed,
}: LeadDecisionInput): boolean {
  if (suppressed) return false;
  return shouldCreateLead(hasWebsite, existingLeadStatus);
}
