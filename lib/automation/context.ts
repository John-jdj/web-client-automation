import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { AppSupabaseClient } from "@/lib/supabase/types";

/**
 * Carries the single Supabase client every reused service function
 * (analyzeLead, generateDemo, deployDemo, generateOutreach, runDiscovery,
 * and the lib/db/*.ts helpers they call) should use for that call —
 * either the normal RLS-scoped client or, for trusted server-side
 * automation only, the service-role client. Every function that accepts
 * this defaults to the RLS-scoped context when none is given, so every
 * existing call site (routes, pages) keeps its exact current behavior
 * unchanged.
 */
export interface AutomationContext {
  supabase: AppSupabaseClient;
}

/**
 * The default, interactive context — cookie-based, RLS-scoped, subject to
 * `is_admin()` like every page/route today. This is what every function
 * falls back to when no context is explicitly passed, so nothing about
 * normal browser/authenticated behavior changes.
 */
export async function getRequestContext(): Promise<AutomationContext> {
  return { supabase: await createClient() };
}

/**
 * Service-role context — bypasses RLS entirely. This exists for exactly
 * one purpose: letting the automation runner (lib/automation/run-automation.ts)
 * execute the same reused service functions from a trusted server-side
 * process that has no user session (a future cron trigger — not added
 * yet). It must never be constructed from a route or function that takes
 * direct, unauthenticated instructions from a browser caller, and must
 * never be exposed to client code — `createServiceClient()` itself is
 * `server-only` and throws if imported into a client bundle.
 */
export function getServiceContext(): AutomationContext {
  return { supabase: createServiceClient() as unknown as AppSupabaseClient };
}
