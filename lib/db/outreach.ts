import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  OutreachMessageSchema,
  type OutreachMessageInput,
} from "@/lib/validation/schemas";
import type { Database } from "@/lib/supabase/database.types";
import type { AppSupabaseClient } from "@/lib/supabase/types";

export type OutreachMessage = Database["public"]["Tables"]["outreach_messages"]["Row"];
export type OutreachMessageUpdate = Database["public"]["Tables"]["outreach_messages"]["Update"];

/** Statuses that mean "already spoken for" for duplicate-outreach protection. */
export const ACTIVE_OR_SENT_STATUSES = ["QUEUED", "SENDING", "SENT"] as const;

export async function createOutreachMessage(
  input: OutreachMessageInput,
  supabase?: AppSupabaseClient
): Promise<OutreachMessage> {
  const parsed = OutreachMessageSchema.parse(input);
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("outreach_messages")
    .insert(parsed)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getOutreachMessage(
  id: string,
  supabase?: AppSupabaseClient
): Promise<OutreachMessage | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("outreach_messages")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateOutreachMessage(
  id: string,
  updates: OutreachMessageUpdate,
  supabase?: AppSupabaseClient
): Promise<OutreachMessage> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("outreach_messages")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Service-role read of a single message by id — for the same one
 * legitimately unauthenticated caller as addSuppressionAsService (see
 * lib/db/suppression.ts): the signed-token unsubscribe route. `id` here
 * always comes from an HMAC-verified token, never directly from the
 * request, so this never lets an anonymous caller browse arbitrary
 * messages by guessing ids.
 */
export async function getOutreachMessageAsService(id: string): Promise<OutreachMessage | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Most recent outreach message for a lead, or null if none exists yet. */
export async function getLatestOutreachForLead(
  leadId: string,
  supabase?: AppSupabaseClient
): Promise<OutreachMessage | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
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
export async function hasActiveOrSentOutreach(
  leadId: string,
  supabase?: AppSupabaseClient
): Promise<boolean> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("outreach_messages")
    .select("id")
    .eq("lead_id", leadId)
    .in("status", ACTIVE_OR_SENT_STATUSES)
    .limit(1);

  if (error) throw error;
  return Boolean(data && data.length > 0);
}
