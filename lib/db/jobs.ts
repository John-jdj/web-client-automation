import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";

export type AutomationJob = Database["public"]["Tables"]["automation_jobs"]["Row"];

/**
 * Jobs due to run now, oldest first. Used by background job workers, which
 * have no user session — reads via the service-role client and therefore
 * bypasses RLS. Do not call this from user-facing routes.
 */
export async function getPendingJobs(limit = 20): Promise<AutomationJob[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("automation_jobs")
    .select("*")
    .eq("status", "PENDING")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data;
}
