/**
 * Prompt for the Claude business-analysis call (lib/ai/anthropic.ts).
 * Bump PROMPT_VERSION whenever the instructions below change meaningfully —
 * it's stored on every lead_analysis row so past analyses stay attributable
 * to the prompt that produced them.
 */
export const PROMPT_VERSION = "v1";

export const BUSINESS_ANALYSIS_SYSTEM_PROMPT = `You are a business analyst helping a web design agency evaluate potential clients discovered through Google Places.

Rules you must follow:
- Analyze ONLY the business information supplied in the user message. Do not invent facts.
- Do not fabricate reviews, testimonials, awards, certifications, or customer numbers that were not provided.
- Do not claim to have personally visited the business, called it, or seen its physical location.
- If a piece of information is unavailable (e.g. no category, no rating), say so plainly rather than guessing — use an empty array, an empty string, or "Unknown" as appropriate, never a fabricated value.
- Base your website-need assessment and page/feature recommendations on the business's category and the information given, following general best practices for that type of business (e.g. a restaurant typically needs a menu, location, contact info, and an ordering or reservation call-to-action; a salon typically needs services, a gallery, and an appointment call-to-action; a clinic typically needs services and a contact/appointment call-to-action — never make medical claims or recommend content implying medical advice).
- Return ONLY the requested structured data — no prose outside the schema, no markdown, no commentary.`;

export interface BusinessAnalysisInput {
  businessName: string;
  category: string | null;
  subcategory: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  rating: number | null;
  reviewCount: number | null;
  phoneAvailable: boolean;
  websitePresent: boolean;
  services: string[] | null;
  openingHours: string[] | null;
}

export function buildBusinessAnalysisUserPrompt(input: BusinessAnalysisInput): string {
  const lines = [
    `Business name: ${input.businessName}`,
    `Category: ${input.category ?? "Unknown"}`,
    `Subcategory: ${input.subcategory ?? "Unknown"}`,
    `Address: ${input.address ?? "Unknown"}`,
    `City: ${input.city ?? "Unknown"}`,
    `State: ${input.state ?? "Unknown"}`,
    `Google rating: ${input.rating ?? "Unknown"}`,
    `Google review count: ${input.reviewCount ?? "Unknown"}`,
    `Phone number on file: ${input.phoneAvailable ? "Yes" : "No"}`,
    `This business does NOT currently have an official website, according to Google Places websiteUri data.`,
    input.services && input.services.length > 0
      ? `Known services: ${input.services.join(", ")}`
      : `Known services: none provided`,
    input.openingHours && input.openingHours.length > 0
      ? `Opening hours: ${input.openingHours.join("; ")}`
      : `Opening hours: not provided`,
  ];

  // websitePresent is always false for businesses we analyze (see lib/ai/analyze-lead.ts
  // eligibility check), but stated explicitly above rather than assumed.
  void input.websitePresent;

  return [
    lines.join("\n"),
    "",
    "Analyze this business and produce the structured recommendation described in your instructions.",
  ].join("\n");
}
