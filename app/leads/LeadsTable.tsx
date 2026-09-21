"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface LeadRow {
  id: string;
  status: string;
  priority: string;
  leadScore: number;
  qualificationStatus: string;
  createdAt: string;
  businessName: string;
  category: string | null;
  hasWebsite: boolean;
  analyzed: boolean;
}

type FilterOption = "all" | "not_analyzed" | "analyzed" | "HOT" | "HIGH" | "MEDIUM" | "LOW";

const FILTERS: { value: FilterOption; label: string }[] = [
  { value: "all", label: "All" },
  { value: "not_analyzed", label: "Not Analyzed" },
  { value: "analyzed", label: "Analyzed" },
  { value: "HOT", label: "HOT" },
  { value: "HIGH", label: "HIGH" },
  { value: "MEDIUM", label: "MEDIUM" },
  { value: "LOW", label: "LOW" },
];

async function analyzeOne(leadId: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch("/api/leads/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    return { ok: false, message: data.error ?? "Analysis failed." };
  }
  return { ok: true, message: data.alreadyAnalyzed ? "Already analyzed" : `Scored ${data.leadScore}` };
}

export default function LeadsTable({
  initialRows,
  dailyAiLimit,
  aiAnalysisEnabled,
}: {
  initialRows: LeadRow[];
  dailyAiLimit: number;
  aiAnalysisEnabled: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<FilterOption>("not_analyzed");
  const [noWebsiteOnly, setNoWebsiteOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (noWebsiteOnly && r.hasWebsite) return false;
      switch (filter) {
        case "not_analyzed":
          return !r.analyzed;
        case "analyzed":
          return r.analyzed;
        case "HOT":
        case "HIGH":
        case "MEDIUM":
        case "LOW":
          return r.priority === filter;
        default:
          return true;
      }
    });
  }, [rows, filter, noWebsiteOnly]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function markAnalyzing(id: string, on: boolean) {
    setAnalyzingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleAnalyze(id: string) {
    markAnalyzing(id, true);
    const result = await analyzeOne(id);
    markAnalyzing(id, false);
    setMessage(result.message);
    if (result.ok) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, analyzed: true } : r)));
    }
  }

  async function handleAnalyzeSelected() {
    for (const id of selected) {
      await handleAnalyze(id);
    }
    setSelected(new Set());
  }

  async function handleAnalyzeAllEligible() {
    setBatchRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/leads/analyze-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: dailyAiLimit }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMessage(data.error ?? "Batch analysis failed.");
        return;
      }
      setMessage(
        `Analyzed ${data.summary.analyzed}, already analyzed ${data.summary.alreadyAnalyzed}, skipped ${data.summary.skipped}, failed ${data.summary.failed}.`
      );
      const analyzedIds = new Set<string>(
        (data.results as Array<{ leadId: string; outcome: string }>)
          .filter((r) => r.outcome === "analyzed" || r.outcome === "already_analyzed")
          .map((r) => r.leadId)
      );
      setRows((prev) => prev.map((r) => (analyzedIds.has(r.id) ? { ...r, analyzed: true } : r)));
    } finally {
      setBatchRunning(false);
    }
  }

  return (
    <div className="mt-6">
      {!aiAnalysisEnabled && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          AI analysis is currently disabled in automation_settings.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3 py-1 text-sm ${
                filter === f.value
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {f.label}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={noWebsiteOnly}
              onChange={(e) => setNoWebsiteOnly(e.target.checked)}
            />
            No Website only
          </label>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleAnalyzeSelected}
            disabled={selected.size === 0}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
          >
            Analyze Selected ({selected.size})
          </button>
          <button
            onClick={handleAnalyzeAllEligible}
            disabled={batchRunning || !aiAnalysisEnabled}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {batchRunning ? "Analyzing..." : `Analyze All Eligible (limit ${dailyAiLimit}/day)`}
          </button>
        </div>
      </div>

      {message && (
        <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {message}
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="py-2 pr-2">
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === filteredRows.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(filteredRows.map((r) => r.id)) : new Set())
                  }
                />
              </th>
              <th className="py-2 pr-4">Business</th>
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Website</th>
              <th className="py-2 pr-4">Score</th>
              <th className="py-2 pr-4">Priority</th>
              <th className="py-2 pr-4">AI Analysis</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelected(r.id)}
                  />
                </td>
                <td className="py-2 pr-4 font-medium text-zinc-900 dark:text-zinc-50">
                  <Link href={`/leads/${r.id}`} className="hover:underline">
                    {r.businessName}
                  </Link>
                </td>
                <td className="py-2 pr-4">{r.category ?? "—"}</td>
                <td className="py-2 pr-4">{r.hasWebsite ? "Website Found" : "No Website"}</td>
                <td className="py-2 pr-4">{r.leadScore}</td>
                <td className="py-2 pr-4">{r.priority}</td>
                <td className="py-2 pr-4">
                  {analyzingIds.has(r.id)
                    ? "Analyzing"
                    : r.analyzed
                      ? "Analyzed"
                      : "Not Analyzed"}
                </td>
                <td className="py-2 pr-4">{r.status}</td>
                <td className="py-2 pr-4">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="py-2 pr-4">
                  <button
                    onClick={() => handleAnalyze(r.id)}
                    disabled={analyzingIds.has(r.id)}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-zinc-700"
                  >
                    Analyze
                  </button>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-6 text-center text-zinc-500 dark:text-zinc-400">
                  No leads match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
