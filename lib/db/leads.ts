import "server-only";
import { createClient } from "@/lib/supabase/server";
import { LeadInputSchema, type LeadInput } from "@/lib/validation/schemas";
import type { Database } from "@/lib/supabase/database.types";
import type { AppSupabaseClient } from "@/lib/supabase/types";
import { shouldCreateLead } from "@/lib/discovery/lead-rules";

export type Lead = Database["public"]["Tables"]["leads"]["Row"];
export type LeadUpdate = Database["public"]["Tables"]["leads"]["Update"];

export { shouldCreateLead };

/** Most recent lead for a business, or null if it has none. */
export async function getLatestLeadForBusiness(
  businessId: string,
  supabase?: AppSupabaseClient
): Promise<Lead | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("leads")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createLead(input: LeadInput, supabase?: AppSupabaseClient): Promise<Lead> {
  const parsed = LeadInputSchema.parse(input);
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("leads")
    .insert(parsed)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getLead(id: string, supabase?: AppSupabaseClient): Promise<Lead | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateLead(id: string, updates: LeadUpdate, supabase?: AppSupabaseClient): Promise<Lead> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("leads")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Leads that have passed qualification and haven't reached a terminal
 * status yet, ordered by score (highest first).
 */
export async function getQualifiedLeads(limit = 50, supabase?: AppSupabaseClient): Promise<Lead[]> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("leads")
    .select("*")
    .eq("qualification_status", "QUALIFIED")
    .not("status", "in", "(CONVERTED,LOST,DISQUALIFIED,DO_NOT_CONTACT)")
    .order("lead_score", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}
