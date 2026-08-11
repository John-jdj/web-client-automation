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
