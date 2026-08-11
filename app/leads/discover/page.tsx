"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DISCOVERY_LIMIT_OPTIONS } from "@/lib/google/constants";

interface DiscoveryBusinessResult {
  id: string;
  businessName: string;
  category: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  hasWebsite: boolean;
  rating: number | null;
  reviewCount: number | null;
  isNewBusiness: boolean;
  leadId: string | null;
  leadStatus: string | null;
  leadCreated: boolean;
  suppressed: boolean;
}

interface DiscoverySummary {
  found: number;
  saved: number;
  duplicates: number;
  withWebsite: number;
  withoutWebsite: number;
  newLeads: number;
}

type FilterOption = "all" | "no_website" | "has_website" | "new_lead" | "duplicate";

const FILTERS: { value: FilterOption; label: string }[] = [
  { value: "all", label: "All" },
  { value: "no_website", label: "No Website" },
  { value: "has_website", label: "Has Website" },
  { value: "new_lead", label: "New Lead" },
  { value: "duplicate", label: "Duplicate" },
];

export default function DiscoverLeadsPage() {
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DiscoverySummary | null>(null);
  const [businesses, setBusinesses] = useState<DiscoveryBusinessResult[]>([]);
  const [filter, setFilter] = useState<FilterOption>("no_website");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/discovery/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, category, limit }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error ?? "Discovery run failed.");
        setSummary(null);
        setBusinesses([]);
        return;
      }

      setSummary(data.summary);
      setBusinesses(data.businesses);
    } catch {
      setError("Could not reach the discovery service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const filteredBusinesses = useMemo(() => {
    switch (filter) {
      case "no_website":
        return businesses.filter((b) => !b.hasWebsite);
      case "has_website":
        return businesses.filter((b) => b.hasWebsite);
      case "new_lead":
        return businesses.filter((b) => b.leadCreated);
      case "duplicate":
        return businesses.filter((b) => !b.isNewBusiness);
      default:
        return businesses;
    }
  }, [businesses, filter]);

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Find Businesses
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Search Google Places for businesses in a location/category and
        automatically flag ones without a website as new leads.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-6 grid grid-cols-1 gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-3"
      >
        <label className="flex flex-col gap-1 text-sm">
          Location
          <input
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Dindigul"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Category
          <input
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Restaurant"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Result Limit
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {DISCOVERY_LIMIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {loading ? "Finding businesses..." : "Find Businesses"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {summary && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <SummaryCard label="Businesses Found" value={summary.found} />
          <SummaryCard label="With Website" value={summary.withWebsite} />
          <SummaryCard label="No Website" value={summary.withoutWebsite} emphasize />
          <SummaryCard label="New Leads" value={summary.newLeads} emphasize />
          <SummaryCard label="Duplicates" value={summary.duplicates} />
        </div>
      )}

      {businesses.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
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
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="py-2 pr-4">Business</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">Location</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Website</th>
                  <th className="py-2 pr-4">Rating</th>
                  <th className="py-2 pr-4">Reviews</th>
                  <th className="py-2 pr-4">Lead Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredBusinesses.map((b) => (
                  <tr
                    key={b.id}
                    className={`border-b border-zinc-100 dark:border-zinc-900 ${
                      !b.hasWebsite ? "bg-amber-50 dark:bg-amber-950/20" : ""
                    }`}
                  >
                    <td className="py-2 pr-4 font-medium text-zinc-900 dark:text-zinc-50">
                      {b.businessName}
                    </td>
                    <td className="py-2 pr-4">{b.category ?? "—"}</td>
                    <td className="py-2 pr-4">{b.city ?? "—"}</td>
                    <td className="py-2 pr-4">{b.phone ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {b.hasWebsite ? (
                        <span className="text-green-700 dark:text-green-400">
                          Website Found
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-700 dark:text-amber-400">
                          No Website
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">{b.rating ?? "—"}</td>
                    <td className="py-2 pr-4">{b.reviewCount ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {b.suppressed ? (
                        <span className="text-zinc-400" title="On the suppression list — no lead created">
                          Suppressed
                        </span>
                      ) : b.leadId && b.leadStatus ? (
                        <Link
                          href={`/leads/${b.leadId}`}
                          className="font-medium text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
                        >
                          {b.leadStatus}
                        </Link>
                      ) : (
                        (b.leadStatus ?? "—")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        emphasize
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</div>
    </div>
  );
}
