import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DemoContentSchema } from "@/lib/validation/schemas";
import DemoPreview from "./DemoPreview";

export const dynamic = "force-dynamic";

export default async function DemoPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: demo } = await supabase.from("demos").select("*").eq("id", id).maybeSingle();
  if (!demo) notFound();

  const { data: lead } = await supabase
    .from("leads")
    .select("business_id")
    .eq("id", demo.lead_id)
    .maybeSingle();

  const { data: business } = lead
    ? await supabase.from("businesses").select("business_name").eq("id", lead.business_id).maybeSingle()
    : { data: null };

  const parsedContent = DemoContentSchema.safeParse(demo.generated_content);
  if (!parsedContent.success) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link href={`/leads`} className="text-sm text-zinc-500 hover:underline">
          ← Back to leads
        </Link>
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          This demo&rsquo;s content is missing or invalid ({demo.status}). Regenerate it from the lead page.
        </div>
      </div>
    );
  }

  return <DemoPreview businessName={business?.business_name ?? demo.name} content={parsedContent.data} />;
}
