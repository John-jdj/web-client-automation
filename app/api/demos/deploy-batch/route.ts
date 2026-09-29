import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DeployBatchRequestSchema } from "@/lib/validation/schemas";
import { getAutomationSettings, countTodaysDeployments } from "@/lib/db/automation-settings";
import { deployDemo, DeployDemoIneligibleError } from "@/lib/demo/deploy-demo";
import { DeploymentError } from "@/lib/vercel/errors";

interface BatchDemoOutcome {
  demoId: string;
  outcome: "deployed" | "already_deployed" | "skipped" | "failed";
  reason?: string;
  deploymentUrl?: string | null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 }
    );
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const parsed = DeployBatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request.", details: z.treeifyError(parsed.error) },
      { status: 400 }
    );
  }

  const settings = await getAutomationSettings();
  if (!settings.auto_deployment_enabled) {
    return NextResponse.json({
      success: true,
      summary: { requested: 0, deployed: 0, alreadyDeployed: 0, skipped: 0, failed: 0 },
      message: "Demo deployment is disabled in automation_settings.",
      results: [],
    });
  }

  const usedToday = await countTodaysDeployments();
  const remainingQuota = Math.max(0, settings.daily_deployment_limit - usedToday);
  const effectiveLimit = Math.min(parsed.data.limit, remainingQuota);

  if (effectiveLimit <= 0) {
    return NextResponse.json({
      success: true,
      summary: { requested: parsed.data.limit, deployed: 0, alreadyDeployed: 0, skipped: 0, failed: 0 },
      message: `Daily deployment limit reached (${settings.daily_deployment_limit}/day).`,
      results: [],
    });
  }

  // Eligible candidates: demos already generated but never deployed. Demos
  // that previously FAILED are intentionally excluded from the batch (a
  // permanent per-demo failure shouldn't retry indefinitely on every
  // batch run) — redeploy those individually via POST /api/demos/[id]/deploy.
  const { data: candidates, error } = await supabase
    .from("demos")
    .select("id, status")
    .eq("status", "GENERATED")
    .order("created_at", { ascending: true })
    .limit(effectiveLimit * 2); // headroom for candidates that turn out already-deployed/ineligible

  if (error) throw error;

  const results: BatchDemoOutcome[] = [];
  let deployed = 0;

  for (const candidate of candidates ?? []) {
    if (deployed >= effectiveLimit) {
      results.push({ demoId: candidate.id, outcome: "skipped", reason: "Daily deployment limit reached." });
      continue;
    }

    try {
      const result = await deployDemo(candidate.id);
      if (result.alreadyDeployed) {
        results.push({ demoId: candidate.id, outcome: "already_deployed", deploymentUrl: result.deploymentUrl });
      } else {
        deployed += 1;
        results.push({
          demoId: candidate.id,
          outcome: "deployed",
          deploymentUrl: result.deploymentUrl,
        });
      }
    } catch (err) {
      if (err instanceof DeployDemoIneligibleError) {
        results.push({ demoId: candidate.id, outcome: "skipped", reason: err.message });
      } else if (err instanceof DeploymentError) {
        results.push({ demoId: candidate.id, outcome: "failed", reason: err.message });
      } else {
        console.error("Batch demo deployment failed:", err);
        results.push({ demoId: candidate.id, outcome: "failed", reason: "Unexpected error." });
      }
    }
  }

  const summary = {
    requested: parsed.data.limit,
    deployed: results.filter((r) => r.outcome === "deployed").length,
    alreadyDeployed: results.filter((r) => r.outcome === "already_deployed").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) => r.outcome === "failed").length,
  };

  return NextResponse.json({ success: true, summary, results });
}
