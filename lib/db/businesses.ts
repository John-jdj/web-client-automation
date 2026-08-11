import "server-only";
import { createClient } from "@/lib/supabase/server";
import { BusinessInputSchema, type BusinessInput } from "@/lib/validation/schemas";
import type { Database } from "@/lib/supabase/database.types";

export type Business = Database["public"]["Tables"]["businesses"]["Row"];

export async function getBusiness(id: string): Promise<Business | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function findBusinessByPlaceId(
  googlePlaceId: string
): Promise<Business | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("google_place_id", googlePlaceId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createBusiness(input: BusinessInput): Promise<Business> {
  const parsed = BusinessInputSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .insert(parsed)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export interface UpsertBusinessResult {
  business: Business;
  isNew: boolean;
}

/**
 * Deduplicated business write. Match order:
 *  1. `google_place_id` (primary, unique) — Google's own stable identifier.
 *  2. `normalized_business_name` + (`phone` or `address`) — secondary
 *     fallback for the rare case a place shows up without a place ID match
 *     (e.g. reprocessing older data).
 * Falls through to insert only when neither match is found.
 */
export async function upsertBusiness(input: BusinessInput): Promise<UpsertBusinessResult> {
  const parsed = BusinessInputSchema.parse(input);
  const supabase = await createClient();

  if (parsed.google_place_id) {
    const existing = await findBusinessByPlaceId(parsed.google_place_id);
    if (existing) {
      const { data, error } = await supabase
        .from("businesses")
        .update(parsed)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return { business: data, isNew: false };
    }
  }

  if (parsed.normalized_business_name && (parsed.phone || parsed.address)) {
    let query = supabase
      .from("businesses")
      .select("*")
      .eq("normalized_business_name", parsed.normalized_business_name);
    query = parsed.phone ? query.eq("phone", parsed.phone) : query.eq("address", parsed.address!);

    const { data: matches, error } = await query.limit(1);
    if (error) throw error;

    if (matches && matches.length > 0) {
      const { data, error: updateError } = await supabase
        .from("businesses")
        .update(parsed)
        .eq("id", matches[0].id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      return { business: data, isNew: false };
    }
  }

  const { data, error } = await supabase
    .from("businesses")
    .insert(parsed)
    .select("*")
    .single();
  if (error) throw error;
  return { business: data, isNew: true };
}
