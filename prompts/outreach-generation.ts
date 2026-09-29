/**
 * Prompt for the Claude outreach-copy call (lib/outreach/generate-outreach-content.ts).
 * Bump PROMPT_VERSION whenever the instructions below change meaningfully.
 */
export const OUTREACH_PROMPT_VERSION = "v1";

export const OUTREACH_SYSTEM_PROMPT = `You are writing a short, professional cold outreach email on behalf of a web design agency, to a local business that does not currently have a website (or has a weak one) and may benefit from one.

Rules you must follow, with no exceptions:
- Use ONLY the facts supplied in the user message. Every claim in the email must be traceable to one of those facts.
- Do NOT invent or imply: awards, certifications, specific customer counts, revenue figures, years in business, number of reviews beyond what's given, testimonials, or any claim about the business's performance that wasn't supplied.
- Do NOT invent services the business wasn't already confirmed to offer.
- Do NOT include any personal information about any individual — write to the business, not a named person, unless a contact name was explicitly supplied (it will not be).
- If a demo URL is supplied, reference it once as the main call-to-action (e.g. inviting them to view the free demo website built for their business). If no demo URL is supplied, use a generic, low-pressure call-to-action instead (e.g. inviting a short reply or call) and do not claim a demo exists.
- Keep it concise: a short subject line, and a body of no more than ~150 words, professional and not salesy or exaggerated.
- Return ONLY the requested structured data — no prose outside the schema, no markdown, no commentary.`;

export interface OutreachContentInput {
  businessName: string;
  category: string | null;
  city: string | null;
  state: string | null;
  hasWebsite: boolean;
  /** Verified, already-validated fields from Step 7's lead_analysis — never re-derived or guessed here. */
  businessSummary: string;
  likelyServices: string[];
  painPoints: string[];
  personalizationPoints: string[];
  /** Only present when a demo has actually been generated and deployed. */
  demoUrl: string | null;
}

export function buildOutreachUserPrompt(input: OutreachContentInput): string {
  const lines = [
    `Business name: ${input.businessName}`,
    `Category: ${input.category ?? "Unknown"}`,
    `Location: ${[input.city, input.state].filter(Boolean).join(", ") || "Unknown"}`,
    `Website status: ${input.hasWebsite ? "Has a website" : "No website on file"}`,
    `Business summary (from prior verified analysis): ${input.businessSummary}`,
    `Confirmed services: ${input.likelyServices.join(", ") || "Not specified"}`,
    `Verified pain points a website would address: ${input.painPoints.join(", ") || "Not specified"}`,
    `Verified personalization points: ${input.personalizationPoints.join(", ") || "Not specified"}`,
    input.demoUrl
      ? `A live demo website has been built for this business at: ${input.demoUrl}`
      : `No demo website exists yet for this business.`,
  ];

  return [
    lines.join("\n"),
    "",
    "Write the outreach email described in your instructions: a subject line, a body, a single clear call-to-action, and the list of personalization points you actually used (each must match one of the verified facts above).",
  ].join("\n");
}
