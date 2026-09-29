import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { PrepareOutreachBatchRequestSchema } from "@/lib/validation/schemas";
import { generateOutreach, GenerateOutreachIneligibleError } from "@/lib/outreach/generate-outreach";
import { AnalysisError } from "@/lib/ai/errors";

interface BatchLeadOutcome {
  leadId: string;
  outcome: "prepared" | "already_draft" | "skipped" | "failed";
  reason?: string;
  messageId?: string;
}

/**
 * Prepares outreach DRAFTs for eligible leads — never sends anything.
 * Every candidate still goes through generateOutreach()'s full
 * eligibility gate (suppression, duplicate protection, missing email,
 * qualification, DO_NOT_CONTACT), so this endpoint can't create a draft
 * that the single-lead route wouldn't also have allowed.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
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

  const parsed = PrepareOutreachBatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request.", details: z.treeifyError(parsed.error) },
      { status: 400 }
    );
  }

  // Candidates: qualified leads not already in a terminal/no-contact
  // state. Each is still individually re-checked by generateOutreach()
  // for a valid email, suppression, and any existing active/sent message.
  const { data: candidates, error } = await supabase
    .from("leads")
    .select("id, qualification_status")
    .eq("qualification_status", "QUALIFIED")
    .not("status", "in", "(CONVERTED,LOST,DO_NOT_CONTACT)")
    .order("created_at", { ascending: true })
    .limit(parsed.data.limit * 2); // headroom for candidates that turn out ineligible/already-drafted

  if (error) throw error;

  const results: BatchLeadOutcome[] = [];
  let prepared = 0;

  for (const candidate of candidates ?? []) {
    if (prepared >= parsed.data.limit) {
      results.push({ leadId: candidate.id, outcome: "skipped", reason: "Batch limit reached." });
      continue;
    }

    try {
      const result = await generateOutreach(candidate.id);
      if (result.alreadyGenerated) {
        results.push({ leadId: candidate.id, outcome: "already_draft", messageId: result.messageId });
      } else {
        prepared += 1;
        results.push({ leadId: candidate.id, outcome: "prepared", messageId: result.messageId });
      }
    } catch (err) {
      if (err instanceof GenerateOutreachIneligibleError) {
        results.push({ leadId: candidate.id, outcome: "skipped", reason: err.message });
      } else if (err instanceof AnalysisError) {
        results.push({ leadId: candidate.id, outcome: "failed", reason: err.message });
      } else {
        console.error("Batch outreach preparation failed:", err);
        results.push({ leadId: candidate.id, outcome: "failed", reason: "Unexpected error." });
      }
    }
  }

  const summary = {
    requested: parsed.data.limit,
    prepared: results.filter((r) => r.outcome === "prepared").length,
    alreadyDraft: results.filter((r) => r.outcome === "already_draft").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) => r.outcome === "failed").length,
  };

  return NextResponse.json({ success: true, summary, results });
}
