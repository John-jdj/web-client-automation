import { testSupabaseConnection } from "@/lib/supabase/test-connection";

export const dynamic = "force-dynamic";

const statusStyles = {
  not_configured: "bg-yellow-50 text-yellow-800 border-yellow-300",
  connected: "bg-green-50 text-green-800 border-green-300",
  error: "bg-red-50 text-red-800 border-red-300",
} as const;

const statusLabels = {
  not_configured: "Not configured",
  connected: "Connected",
  error: "Connection failed",
} as const;

export default async function SupabaseTestPage() {
  const result = await testSupabaseConnection();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 p-8 dark:bg-black">
      <div className="w-full max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Supabase Connection Test
        </h1>
        <div
          className={`rounded-lg border p-4 text-sm ${statusStyles[result.status]}`}
        >
          <p className="font-medium">{statusLabels[result.status]}</p>
          <p className="mt-1">{result.message}</p>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          This is a temporary diagnostic route for verifying Supabase
          integration during setup. Remove it before shipping to production.
        </p>
      </div>
    </div>
  );
}
