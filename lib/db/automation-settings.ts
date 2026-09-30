import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { AppSupabaseClient } from "@/lib/supabase/types";

export type AutomationSettings = Database["public"]["Tables"]["automation_settings"]["Row"];

/** The single automation_settings row (see supabase/migrations — enforced unique). */
export async function getAutomationSettings(supabase?: AppSupabaseClient): Promise<AutomationSettings> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client.from("automation_settings").select("*").single();

  if (error) throw error;
  return data;
}

/**
 * How many `anthropic` / `business_analysis` api_usage rows were logged
 * today (UTC), for enforcing `automation_settings.daily_ai_limit`.
 */
export async function countTodaysAiAnalyses(supabase?: AppSupabaseClient): Promise<number> {
  const client = supabase ?? (await createClient());
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await client
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("provider", "anthropic")
    .eq("operation", "business_analysis")
    .gte("created_at", startOfDayUtc.toISOString());

  if (error) throw error;
  return count ?? 0;
}

/**
 * How many `email` / `outreach_send` api_usage rows were logged today
 * (UTC), for enforcing `automation_settings.daily_outreach_limit`. Only
 * counts real successful sends — see lib/outreach/send-outreach.ts, which
 * logs this row only after the email provider confirms success (DEMO_MODE
 * or real), never on a blocked/failed attempt.
 */
export async function countTodaysOutreachSends(supabase?: AppSupabaseClient): Promise<number> {
  const client = supabase ?? (await createClient());
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await client
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("provider", "email")
    .eq("operation", "outreach_send")
    .gte("created_at", startOfDayUtc.toISOString());

  if (error) throw error;
  return count ?? 0;
}

/**
 * How many `vercel` / `demo_deployment` api_usage rows were logged today
 * (UTC), for enforcing `automation_settings.daily_deployment_limit`.
 */
export async function countTodaysDeployments(supabase?: AppSupabaseClient): Promise<number> {
  const client = supabase ?? (await createClient());
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await client
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("provider", "vercel")
    .eq("operation", "demo_deployment")
    .gte("created_at", startOfDayUtc.toISOString());

  if (error) throw error;
  return count ?? 0;
}
