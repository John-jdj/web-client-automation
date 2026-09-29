import type { OutreachContentInput } from "@/prompts/outreach-generation";
import type { OutreachCopyOutput } from "@/lib/validation/schemas";

/**
 * Deterministic stand-in for the Claude outreach-copy call, used whenever
 * DEMO_MODE is enabled (see lib/outreach/generate-outreach-content.ts).
 * Built entirely from already-verified business/analysis fields — no
 * fabrication, no network call. Mirrors lib/demo/mock-content.ts's
 * rationale exactly.
 */
export function buildMockOutreachContent(input: OutreachContentInput): OutreachCopyOutput {
  const location = [input.city, input.state].filter(Boolean).join(", ");
  const personalizationPoints =
    input.personalizationPoints.length > 0
      ? input.personalizationPoints
      : input.painPoints.length > 0
        ? input.painPoints
        : [`${input.category ?? "Local business"}${location ? ` in ${location}` : ""}`];

  const cta = input.demoUrl
    ? "Take a look at the free demo website we built for you"
    : "Reply if you'd like to see a free demo website for your business";

  const bodyLines = [
    `Hi ${input.businessName} team,`,
    "",
    input.businessSummary || `We came across ${input.businessName} and wanted to reach out.`,
    input.hasWebsite
      ? "We noticed your current website could use a refresh, so we put one together to show what's possible."
      : "We noticed you don't currently have a website, so we put one together to show what's possible — no cost, no obligation.",
    "",
    input.demoUrl ? `You can view it here: ${input.demoUrl}` : cta + ".",
    "",
    "Happy to answer any questions.",
  ];

  return {
    subject: `A free demo website for ${input.businessName}`,
    body: bodyLines.join("\n"),
    cta,
    personalizationPoints: personalizationPoints.slice(0, 5),
  };
}
