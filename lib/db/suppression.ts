import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Checks whether a business's phone or email appears in `suppression_list`.
 * Suppressed businesses must never receive a new outreach-eligible lead —
 * they can still appear in discovery results, just without lead creation.
 */
export async function isSuppressed(contact: {
  phone: string | null;
  email: string | null;
}): Promise<boolean> {
  if (!contact.phone && !contact.email) return false;

  const supabase = await createClient();

  // Two separate equality queries instead of building a single `.or()`
  // filter string, so neither value needs to be embedded into PostgREST's
  // filter syntax (avoids any risk of filter-string injection).
  if (contact.email) {
    const { data, error } = await supabase
      .from("suppression_list")
      .select("id")
      .eq("email", contact.email)
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) return true;
  }

  if (contact.phone) {
    const { data, error } = await supabase
      .from("suppression_list")
      .select("id")
      .eq("phone", contact.phone)
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) return true;
  }

  return false;
}

/**
 * Adds an email (or phone) to the suppression list, so no future outreach
 * of any kind is generated or sent to it (isSuppressed above, and every
 * outreach eligibility check, reads this table). Idempotent by checking
 * first — `email` is unique in the schema, so a blind insert would error
 * on a repeat call for the same address.
 */
export async function addSuppression(input: {
  email?: string | null;
  phone?: string | null;
  reason?: string | null;
  source?: string | null;
}): Promise<void> {
  if (!input.email && !input.phone) return;

  const alreadySuppressed = await isSuppressed({
    phone: input.phone ?? null,
    email: input.email ?? null,
  });
  if (alreadySuppressed) return;

  const supabase = await createClient();
  const { error } = await supabase.from("suppression_list").insert({
    email: input.email ?? null,
    phone: input.phone ?? null,
    reason: input.reason ?? null,
    source: input.source ?? null,
  });

  if (error) throw error;
}
