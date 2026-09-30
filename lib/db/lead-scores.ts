import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { AppSupabaseClient } from "@/lib/supabase/types";

export type LeadScoreRow = Database["public"]["Tables"]["lead_scores"]["Row"];
export type LeadScoreInsert = Database["public"]["Tables"]["lead_scores"]["Insert"];

export async function createLeadScore(
  input: LeadScoreInsert,
  supabase?: AppSupabaseClient
): Promise<LeadScoreRow> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("lead_scores")
    .insert(input)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/** Most recent score row for a lead, or null if it has never been scored. */
export async function getLatestLeadScore(
  leadId: string,
  supabase?: AppSupabaseClient
): Promise<LeadScoreRow | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("lead_scores")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
