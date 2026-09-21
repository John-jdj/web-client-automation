import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DemoInputSchema, type DemoInput } from "@/lib/validation/schemas";
import type { Database } from "@/lib/supabase/database.types";

export type Demo = Database["public"]["Tables"]["demos"]["Row"];

export async function createDemo(input: DemoInput): Promise<Demo> {
  const parsed = DemoInputSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("demos")
    .insert(parsed)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getDemo(id: string): Promise<Demo | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("demos")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Most recent demo for a lead, or null if none has been generated yet. */
export async function getLatestDemoForLead(leadId: string): Promise<Demo | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("demos")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
