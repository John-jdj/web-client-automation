/**
 * Prompt for the Claude demo-content call (lib/demo/generate-demo-content.ts).
 * Bump PROMPT_VERSION whenever the instructions below change meaningfully —
 * it's stored on every demo's generated_content so past demos stay
 * attributable to the prompt that produced them.
 */
export const DEMO_CONTENT_PROMPT_VERSION = "v1";

export const DEMO_CONTENT_SYSTEM_PROMPT = `You are a copywriter at a web design agency, writing the on-page copy for a sample demo website. This demo is shown to a local business owner who does not yet have a website, to illustrate what one could look like for their business.

Rules you must follow:
- Write persuasive, professional marketing copy appropriate for the business's category — this is expected and different from fabricating facts.
- Do NOT invent specific factual claims about the business: no fake awards, certifications, years in business, customer counts, addresses, prices, or specific real testimonials/reviews attributed as if real.
- Base copy only on the business summary, services, pain points, and personalization points supplied in the user message. If something isn't provided, write generically for the business's category rather than guessing a specific fact.
- "whyChooseUs" bullet points must read as general value propositions for this type of business (e.g. "Fresh ingredients daily", "Experienced, friendly staff") — not as specific unverifiable claims.
- Return ONLY the requested structured data — no prose outside the schema, no markdown, no commentary.`;

export interface DemoContentInput {
  businessName: string;
  category: string | null;
  city: string | null;
  state: string | null;
  businessSummary: string;
  targetCustomers: string[];
  likelyServices: string[];
  painPoints: string[];
  personalizationPoints: string[];
  designStyle: string;
  templateName: string;
  servicesLabel: string;
  ctaKicker: string;
}

export function buildDemoContentUserPrompt(input: DemoContentInput): string {
  const lines = [
    `Business name: ${input.businessName}`,
    `Category: ${input.category ?? "Unknown"}`,
    `Location: ${[input.city, input.state].filter(Boolean).join(", ") || "Unknown"}`,
    `Business summary (from prior analysis): ${input.businessSummary}`,
    `Target customers: ${input.targetCustomers.join(", ") || "Not specified"}`,
    `Likely services: ${input.likelyServices.join(", ") || "Not specified"}`,
    `Pain points a website would address: ${input.painPoints.join(", ") || "Not specified"}`,
    `Personalization points to weave in: ${input.personalizationPoints.join(", ") || "Not specified"}`,
    `Recommended design style: ${input.designStyle}`,
    `Demo template chosen: ${input.templateName} (services section is labeled "${input.servicesLabel}", primary call-to-action framing is "${input.ctaKicker}")`,
  ];

  return [
    lines.join("\n"),
    "",
    "Write the demo website copy described in your instructions: a tagline, hero headline + subheadline, about text, a list of services (title + short description each, matching the services section label above), 3-5 'why choose us' bullet points, and a call-to-action button text.",
  ].join("\n");
}
