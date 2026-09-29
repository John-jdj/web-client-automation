import { getTemplateBySlug, TEMPLATES } from "@/lib/templates/registry";
import type { DemoContentOutput } from "@/lib/validation/schemas";

const PALETTE_HEX: Record<string, { primary: string; secondary: string; accent: string }> = {
  "restaurant-cafe": { primary: "#ea580c", secondary: "#fff7ed", accent: "#ea580c" },
  "health-wellness": { primary: "#0d9488", secondary: "#f0fdfa", accent: "#0d9488" },
  "hospitality-events": { primary: "#4f46e5", secondary: "#eef2ff", accent: "#4f46e5" },
  "retail-boutique": { primary: "#e11d48", secondary: "#fff1f2", accent: "#e11d48" },
  "general-business": { primary: "#27272a", secondary: "#fafafa", accent: "#27272a" },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders a single, self-contained static HTML page for a demo — the
 * public artifact actually pushed to Vercel. Takes only the already
 * Zod-validated `DemoContentOutput` (Step 8's output) plus a business
 * display name; both are scrubbed of CRM/internal fields by construction
 * (DemoContentSchema has no id/status/score/analysis fields to leak), and
 * nothing here ever touches Supabase, env vars, or request headers — so
 * there is no path for a secret to end up in the deployed output.
 */
export function renderStaticDemoHtml(businessName: string, content: DemoContentOutput): string {
  const template = getTemplateBySlug(content.templateSlug) ?? TEMPLATES[TEMPLATES.length - 1];
  const colors = PALETTE_HEX[template.slug] ?? PALETTE_HEX["general-business"];
  const name = escapeHtml(businessName);

  const servicesHtml = content.services
    .map(
      (s) => `<div class="card">
        <h3>${escapeHtml(s.title)}</h3>
        <p>${escapeHtml(s.description)}</p>
      </div>`
    )
    .join("\n");

  const whyChooseUsHtml = content.whyChooseUs.map((point) => `<li>${escapeHtml(point)}</li>`).join("\n");

  const contactLines = [content.contactInfo.address, content.contactInfo.city, content.contactInfo.phone]
    .filter((v): v is string => Boolean(v))
    .map((v) => `<p>${escapeHtml(v)}</p>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}</title>
<meta name="robots" content="noindex" />
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #18181b; }
  header, footer { background: ${colors.primary}; color: #fff; text-align: center; padding: 4rem 1.5rem; }
  header p.kicker { text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.85rem; opacity: 0.85; margin: 0 0 0.75rem; }
  header h1 { font-size: 2.25rem; margin: 0 0 0.75rem; }
  header p.sub { max-width: 40rem; margin: 0 auto; opacity: 0.9; }
  .cta { display: inline-block; margin-top: 2rem; background: #fff; color: #18181b; padding: 0.75rem 1.5rem; border-radius: 999px; font-weight: 600; text-decoration: none; }
  section { max-width: 64rem; margin: 0 auto; padding: 3rem 1.5rem; }
  section.tinted { background: ${colors.secondary}; max-width: none; }
  section.tinted > div { max-width: 64rem; margin: 0 auto; }
  h2 { text-align: center; color: ${colors.accent}; }
  .grid { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-top: 2rem; }
  .card { background: #fff; border-radius: 0.5rem; padding: 1.25rem; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
  .card h3 { margin: 0 0 0.5rem; }
  ul.why { max-width: 32rem; margin: 1.5rem auto 0; }
  footer p { margin: 0.25rem 0; opacity: 0.9; font-size: 0.9rem; }
  footer .meta { margin-top: 1.5rem; font-size: 0.75rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.05em; }
</style>
</head>
<body>
  <header>
    <p class="kicker">${escapeHtml(content.tagline)}</p>
    <h1>${escapeHtml(content.heroHeadline)}</h1>
    <p class="sub">${escapeHtml(content.heroSubheadline)}</p>
    <a class="cta" href="#contact">${escapeHtml(content.ctaText)}</a>
  </header>

  <section>
    <h2>About ${name}</h2>
    <p>${escapeHtml(content.aboutText)}</p>
  </section>

  <section class="tinted">
    <div>
      <h2>${escapeHtml(template.servicesLabel)}</h2>
      <div class="grid">
${servicesHtml}
      </div>
    </div>
  </section>

  <section>
    <h2>Why Choose Us</h2>
    <ul class="why">
${whyChooseUsHtml}
    </ul>
  </section>

  <footer id="contact">
    <h2 style="color:#fff">${escapeHtml(content.ctaText)}</h2>
${contactLines}
    <p class="meta">Design style: ${escapeHtml(content.designStyle)} · Template: ${escapeHtml(template.name)}</p>
  </footer>
</body>
</html>
`;
}
