import type { createClient } from "./server";

/**
 * Shared type for either Supabase client flavor this app uses: the
 * cookie-based, RLS-scoped client (lib/supabase/server.ts — every
 * interactive route/page) or the service-role client
 * (lib/supabase/service.ts — trusted server-only automation execution
 * only, see lib/automation/context.ts). Both wrap the same underlying
 * @supabase/supabase-js client against the same Database schema, so
 * `lib/db/*.ts` helpers can accept either without knowing which one
 * they were given.
 */
export type AppSupabaseClient = Awaited<ReturnType<typeof createClient>>;
