import { createClient } from "@/lib/supabase/server";
import LeadsTable, { type LeadRow } from "./LeadsTable";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, status, priority, lead_score, qualification_status, created_at, businesses(business_name, category, has_website), lead_analysis(id)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const { data: settings } = await supabase
    .from("automation_settings")
    .select("daily_ai_limit, ai_analysis_enabled")
    .single();

  const rows: LeadRow[] = (data ?? []).map((row) => {
    const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
    return {
      id: row.id,
      status: row.status,
      priority: row.priority,
      leadScore: row.lead_score,
      qualificationStatus: row.qualification_status,
      createdAt: row.created_at,
      businessName: business?.business_name ?? "Unknown business",
      category: business?.category ?? null,
      hasWebsite: business?.has_website ?? false,
      analyzed: Array.isArray(row.lead_analysis) && row.lead_analysis.length > 0,
    };
  });

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Leads</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Run Claude business analysis and deterministic scoring on discovered no-website leads.
      </p>

      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Failed to load leads: {error.message}
        </div>
      )}

      <LeadsTable
        initialRows={rows}
        dailyAiLimit={settings?.daily_ai_limit ?? 50}
        aiAnalysisEnabled={settings?.ai_analysis_enabled ?? true}
      />
    </div>
  );
}
