/**
 * Lowercase, hyphen-separated slug matching DemoInputSchema's slug regex
 * (^[a-z0-9]+(?:-[a-z0-9]+)*$). Non-alphanumeric runs collapse to a single
 * hyphen; leading/trailing hyphens are trimmed.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Business-name slug plus a short, stable suffix from the lead id, so re-running a demo for the same lead reuses a predictable slug base. */
export function buildDemoSlug(businessName: string, leadId: string): string {
  const base = slugify(businessName) || "business";
  const suffix = leadId.replace(/-/g, "").slice(0, 8);
  return `${base}-${suffix}`;
}
