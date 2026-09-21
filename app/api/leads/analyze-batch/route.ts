import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AnalyzeBatchRequestSchema } from "@/lib/validation/schemas";
import { getAutomationSettings, countTodaysAiAnalyses } from "@/lib/db/automation-settings";
import { analyzeLead, AnalyzeLeadIneligibleError } from "@/lib/ai/analyze-lead";
import { AnalysisError } from "@/lib/ai/errors";

interface BatchLeadOutcome {
  leadId: string;
  outcome: "analyzed" | "already_analyzed" | "skipped" | "failed";
  reason?: string;
  leadScore?: number;
  priority?: string;
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

  const parsed = AnalyzeBatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request.", details: z.treeifyError(parsed.error) },
      { status: 400 }
    );
  }

  const settings = await getAutomationSettings();
  if (!settings.ai_analysis_enabled) {
    return NextResponse.json({
      success: true,
      summary: { requested: 0, analyzed: 0, alreadyAnalyzed: 0, skipped: 0, failed: 0 },
      message: "AI analysis is disabled in automation_settings.",
      results: [],
    });
  }

  const usedToday = await countTodaysAiAnalyses();
  const remainingQuota = Math.max(0, settings.daily_ai_limit - usedToday);
  const effectiveLimit = Math.min(parsed.data.limit, remainingQuota);

  if (effectiveLimit <= 0) {
    return NextResponse.json({
      success: true,
      summary: { requested: parsed.data.limit, analyzed: 0, alreadyAnalyzed: 0, skipped: 0, failed: 0 },
      message: `Daily AI analysis limit reached (${settings.daily_ai_limit}/day).`,
      results: [],
    });
  }

  // Eligible candidates: no website, not yet in a terminal/active-analysis
  // state, and not already analyzed (checked per-lead below via
  // analyzeLead's own idempotency — cheap since it skips the Claude call).
  const { data: candidates, error } = await supabase
    .from("leads")
    .select("id, status, businesses!inner(has_website)")
    .in("status", ["NEW", "ANALYZING"])
    .eq("businesses.has_website", false)
    .order("created_at", { ascending: true })
    .limit(effectiveLimit * 2); // headroom for candidates that turn out already-analyzed/suppressed

  if (error) throw error;

  const results: BatchLeadOutcome[] = [];
  let analyzed = 0;

  for (const candidate of candidates ?? []) {
    if (analyzed >= effectiveLimit) {
      results.push({ leadId: candidate.id, outcome: "skipped", reason: "Daily AI limit reached." });
      continue;
    }

    try {
      const result = await analyzeLead(candidate.id);
      if (result.alreadyAnalyzed) {
        results.push({ leadId: candidate.id, outcome: "already_analyzed" });
      } else {
        analyzed += 1;
        results.push({
          leadId: candidate.id,
          outcome: "analyzed",
          leadScore: result.leadScore,
          priority: result.priority,
        });
      }
    } catch (err) {
      if (err instanceof AnalyzeLeadIneligibleError) {
        results.push({ leadId: candidate.id, outcome: "skipped", reason: err.message });
      } else if (err instanceof AnalysisError) {
        results.push({ leadId: candidate.id, outcome: "failed", reason: err.message });
      } else {
        console.error("Batch lead analysis failed:", err);
        results.push({ leadId: candidate.id, outcome: "failed", reason: "Unexpected error." });
      }
    }
  }

  const summary = {
    requested: parsed.data.limit,
    analyzed: results.filter((r) => r.outcome === "analyzed").length,
    alreadyAnalyzed: results.filter((r) => r.outcome === "already_analyzed").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) => r.outcome === "failed").length,
  };

  return NextResponse.json({ success: true, summary, results });
}
