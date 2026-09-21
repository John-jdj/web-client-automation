import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DemoActions from "./DemoActions";

export const dynamic = "force-dynamic";

function priorityColor(priority: string) {
  switch (priority) {
    case "HOT":
      return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300";
    case "HIGH":
      return "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300";
    case "MEDIUM":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
    default:
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

function List({ title, items }: { title: string; items: unknown }) {
  const list = Array.isArray(items) ? (items as unknown[]) : [];
  if (list.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
      <ul className="mt-1 list-inside list-disc text-sm text-zinc-600 dark:text-zinc-400">
        {list.map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (!lead) notFound();

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", lead.business_id)
    .maybeSingle();

  const { data: analysis } = await supabase
    .from("lead_analysis")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: score } = await supabase
    .from("lead_scores")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: demo } = await supabase
    .from("demos")
    .select("id, status, slug")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const rawResponse = analysis?.raw_response as
    | { data?: { websiteNeed?: { level?: string; reason?: string } } }
    | null
    | undefined;
  const websiteNeed = rawResponse?.data?.websiteNeed;

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <Link href="/leads" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← Back to leads
      </Link>

      <h1 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {business?.business_name ?? "Unknown business"}
      </h1>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Business Information
          </h2>
          <dl className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <div>
              <dt className="inline font-medium">Category: </dt>
              <dd className="inline">{business?.category ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Address: </dt>
              <dd className="inline">{business?.address ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Phone: </dt>
              <dd className="inline">{business?.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Website: </dt>
              <dd className="inline">
                {business?.has_website ? "Website Found" : "No Website"}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">Google rating: </dt>
              <dd className="inline">{business?.rating ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Review count: </dt>
              <dd className="inline">{business?.review_count ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Lead Score</h2>
          {score ? (
            <>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
                  {score.score} / 100
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${priorityColor(lead.priority)}`}
                >
                  {lead.priority}
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full bg-zinc-900 dark:bg-zinc-50"
                  style={{ width: `${Math.max(0, Math.min(100, score.score))}%` }}
                />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                <div>Website: {score.website_score}</div>
                <div>Rating: {score.rating_score}</div>
                <div>Reviews: {score.review_score}</div>
                <div>Phone: {score.phone_score}</div>
                <div>Email: {score.email_score}</div>
                <div>Category: {score.category_score}</div>
                <div>Activity: {score.activity_score}</div>
              </dl>
              {score.reasoning && (
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{score.reasoning}</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Not analyzed yet.</p>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">AI Analysis</h2>
        {analysis ? (
          <div className="mt-3 space-y-4">
            {analysis.business_summary && (
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {analysis.business_summary}
              </p>
            )}
            {websiteNeed?.level && (
              <div className="text-sm">
                <span className="font-semibold">Website need: </span>
                {websiteNeed.level}
                {websiteNeed.reason ? ` — ${websiteNeed.reason}` : ""}
              </div>
            )}
            {analysis.target_customer && (
              <div className="text-sm">
                <span className="font-semibold">Target customers: </span>
                {analysis.target_customer}
              </div>
            )}
            <List title="Likely services" items={analysis.services} />
            <List title="Recommended pages" items={analysis.recommended_pages} />
            <List title="Recommended features" items={analysis.recommended_features} />
            {analysis.design_style && (
              <div className="text-sm">
                <span className="font-semibold">Design style: </span>
                {analysis.design_style}
              </div>
            )}
            <List title="Recommended colors" items={analysis.recommended_colors} />
            <List title="Recommended CTAs" items={analysis.recommended_ctas} />
            <List title="Pain points" items={analysis.pain_points} />
            <List title="Personalization points" items={analysis.personalization_points} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            This lead has not been analyzed yet. Go to{" "}
            <Link href="/leads" className="underline">
              /leads
            </Link>{" "}
            to run analysis.
          </p>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Demo Website</h2>
        <DemoActions
          leadId={id}
          qualified={lead.qualification_status === "QUALIFIED"}
          initialDemo={demo && demo.status === "GENERATED" ? demo : null}
        />
      </section>
    </div>
  );
}
