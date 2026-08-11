import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  OutreachMessageSchema,
  type OutreachMessageInput,
} from "@/lib/validation/schemas";
import type { Database } from "@/lib/supabase/database.types";

export type OutreachMessage = Database["public"]["Tables"]["outreach_messages"]["Row"];

export async function createOutreachMessage(
  input: OutreachMessageInput
): Promise<OutreachMessage> {
  const parsed = OutreachMessageSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_messages")
    .insert(parsed)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
