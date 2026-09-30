import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DemoInputSchema, type DemoInput } from "@/lib/validation/schemas";
import type { Database } from "@/lib/supabase/database.types";
import type { AppSupabaseClient } from "@/lib/supabase/types";

export type Demo = Database["public"]["Tables"]["demos"]["Row"];
export type DemoUpdate = Database["public"]["Tables"]["demos"]["Update"];

export async function createDemo(input: DemoInput, supabase?: AppSupabaseClient): Promise<Demo> {
  const parsed = DemoInputSchema.parse(input);
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("demos")
    .insert(parsed)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateDemo(id: string, updates: DemoUpdate, supabase?: AppSupabaseClient): Promise<Demo> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("demos")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getDemo(id: string, supabase?: AppSupabaseClient): Promise<Demo | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("demos")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Most recent demo for a lead, or null if none has been generated yet. */
export async function getLatestDemoForLead(leadId: string, supabase?: AppSupabaseClient): Promise<Demo | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("demos")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
