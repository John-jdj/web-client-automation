import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type LeadAnalysis = Database["public"]["Tables"]["lead_analysis"]["Row"];
export type LeadAnalysisInsert = Database["public"]["Tables"]["lead_analysis"]["Insert"];

/** Most recent analysis for a lead, or null if it has never been analyzed. */
export async function getLatestLeadAnalysis(leadId: string): Promise<LeadAnalysis | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_analysis")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createLeadAnalysis(input: LeadAnalysisInsert): Promise<LeadAnalysis> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_analysis")
    .insert(input)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
