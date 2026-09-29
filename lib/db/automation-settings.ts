import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type AutomationSettings = Database["public"]["Tables"]["automation_settings"]["Row"];

/** The single automation_settings row (see supabase/migrations — enforced unique). */
export async function getAutomationSettings(): Promise<AutomationSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("automation_settings").select("*").single();

  if (error) throw error;
  return data;
}

/**
 * How many `anthropic` / `business_analysis` api_usage rows were logged
 * today (UTC), for enforcing `automation_settings.daily_ai_limit`.
 */
export async function countTodaysAiAnalyses(): Promise<number> {
  const supabase = await createClient();
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("provider", "anthropic")
    .eq("operation", "business_analysis")
    .gte("created_at", startOfDayUtc.toISOString());

  if (error) throw error;
  return count ?? 0;
}

/**
 * How many `vercel` / `demo_deployment` api_usage rows were logged today
 * (UTC), for enforcing `automation_settings.daily_deployment_limit`.
 */
export async function countTodaysDeployments(): Promise<number> {
  const supabase = await createClient();
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("provider", "vercel")
    .eq("operation", "demo_deployment")
    .gte("created_at", startOfDayUtc.toISOString());

  if (error) throw error;
  return count ?? 0;
}
