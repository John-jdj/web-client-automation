import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  OutreachMessageSchema,
  type OutreachMessageInput,
} from "@/lib/validation/schemas";
import type { Database } from "@/lib/supabase/database.types";

export type OutreachMessage = Database["public"]["Tables"]["outreach_messages"]["Row"];
export type OutreachMessageUpdate = Database["public"]["Tables"]["outreach_messages"]["Update"];

/** Statuses that mean "already spoken for" for duplicate-outreach protection. */
export const ACTIVE_OR_SENT_STATUSES = ["QUEUED", "SENDING", "SENT"] as const;

export async function createOutreachMessage(
  input: OutreachMessageInput
): Promise<OutreachMessage> {
  const parsed = OutreachMessageSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_messages")
    .insert(parsed)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getOutreachMessage(id: string): Promise<OutreachMessage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateOutreachMessage(
  id: string,
  updates: OutreachMessageUpdate
): Promise<OutreachMessage> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_messages")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/** Most recent outreach message for a lead, or null if none exists yet. */
export async function getLatestOutreachForLead(leadId: string): Promise<OutreachMessage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Duplicate-protection check (Step 10, requirement 9): is there already a
 * SENT, or currently in-flight (QUEUED/SENDING), outreach message for
 * this lead? Excludes DRAFT/CANCELLED/FAILED — those don't block a new
 * attempt. Safe to call repeatedly (read-only).
 */
export async function hasActiveOrSentOutreach(leadId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("id")
    .eq("lead_id", leadId)
    .in("status", ACTIVE_OR_SENT_STATUSES)
    .limit(1);

  if (error) throw error;
  return Boolean(data && data.length > 0);
}
