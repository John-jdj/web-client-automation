import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DeploymentInputSchema, type DeploymentInput } from "@/lib/validation/schemas";
import type { Database } from "@/lib/supabase/database.types";

export type DemoDeployment = Database["public"]["Tables"]["demo_deployments"]["Row"];
export type DemoDeploymentUpdate = Database["public"]["Tables"]["demo_deployments"]["Update"];

export async function createDeployment(input: DeploymentInput): Promise<DemoDeployment> {
  const parsed = DeploymentInputSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("demo_deployments")
    .insert(parsed)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateDeployment(
  id: string,
  updates: DemoDeploymentUpdate
): Promise<DemoDeployment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("demo_deployments")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/** Most recent deployment attempt for a demo, or null if none has been made yet. */
export async function getLatestDeploymentForDemo(demoId: string): Promise<DemoDeployment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("demo_deployments")
    .select("*")
    .eq("demo_id", demoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
