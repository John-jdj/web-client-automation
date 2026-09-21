import type { DemoContentInput } from "@/prompts/demo-generation";
import type { DemoCopyOutput } from "@/lib/validation/schemas";

/**
 * Deterministic stand-in for the Claude demo-copy call, used whenever
 * DEMO_MODE is enabled (see lib/demo/generate-demo-content.ts). Built
 * entirely from the business + Step 7 analysis fields already validated
 * and stored — no fabrication, no network call, no Anthropic credits
 * spent. Same shape as the real Claude output (DemoCopySchema) so callers
 * never need to know which path produced it.
 */
export function buildMockDemoContent(input: DemoContentInput): DemoCopyOutput {
  const location = [input.city, input.state].filter(Boolean).join(", ");
  const services =
    input.likelyServices.length > 0
      ? input.likelyServices
      : ["Consultation", "Custom Solutions", "Ongoing Support"];

  return {
    tagline: `${input.businessName} — ${input.category ?? "Local Business"}${location ? ` in ${location}` : ""}`,
    heroHeadline: `Welcome to ${input.businessName}`,
    heroSubheadline:
      input.businessSummary || `${input.category ?? "A local business"} serving the community.`,
    aboutText:
      input.businessSummary ||
      `${input.businessName} is a ${(input.category ?? "local business").toLowerCase()} dedicated to serving its customers well.`,
    services: services.slice(0, 6).map((service) => ({
      title: service,
      description: `Learn more about our ${service.toLowerCase()} and how we can help.`,
    })),
    whyChooseUs:
      input.personalizationPoints.length > 0
        ? input.personalizationPoints.slice(0, 5)
        : [
            `Trusted by the ${location || "local"} community`,
            "Friendly, experienced team",
            "Convenient location and hours",
          ],
    ctaText: input.ctaKicker,
  };
}
