import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type LeadScoreRow = Database["public"]["Tables"]["lead_scores"]["Row"];
export type LeadScoreInsert = Database["public"]["Tables"]["lead_scores"]["Insert"];

export async function createLeadScore(input: LeadScoreInsert): Promise<LeadScoreRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_scores")
    .insert(input)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/** Most recent score row for a lead, or null if it has never been scored. */
export async function getLatestLeadScore(leadId: string): Promise<LeadScoreRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_scores")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
