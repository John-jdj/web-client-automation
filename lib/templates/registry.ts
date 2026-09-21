/**
 * Static demo-website template registry (Step 8's "Select Business
 * Template" stage). `demo_templates` exists as a DB table for a future
 * DB-driven template catalog, but nothing reads from it yet — keeping
 * selection in code avoids depending on unseeded data and keeps template
 * choice a pure, easily-tested function of `business.category`.
 *
 * Matching is first-match-wins in array order, so `general-business`
 * (matches everything) must stay last.
 */
export interface DemoTemplate {
  slug: string;
  name: string;
  /** Section label used in place of generic "Our Services" copy. */
  servicesLabel: string;
  /** Primary call-to-action framing shown in the hero (e.g. "Book", "Order"). */
  ctaKicker: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
  };
  keywords: string[];
}

export const TEMPLATES: DemoTemplate[] = [
  {
    slug: "restaurant-cafe",
    name: "Restaurant & Cafe",
    servicesLabel: "Menu Highlights",
    ctaKicker: "Reserve a table or order online",
    palette: { primary: "bg-orange-600", secondary: "bg-orange-50", accent: "text-orange-600" },
    keywords: ["restaurant", "cafe", "coffee", "bakery", "bar", "catering"],
  },
  {
    slug: "health-wellness",
    name: "Health & Wellness",
    servicesLabel: "Our Services",
    ctaKicker: "Book an appointment",
    palette: { primary: "bg-teal-600", secondary: "bg-teal-50", accent: "text-teal-600" },
    keywords: ["gym", "fitness", "salon", "spa", "beauty", "clinic", "dentist", "doctor", "hospital"],
  },
  {
    slug: "hospitality-events",
    name: "Hospitality & Events",
    servicesLabel: "What We Offer",
    ctaKicker: "Check availability",
    palette: { primary: "bg-indigo-600", secondary: "bg-indigo-50", accent: "text-indigo-600" },
    keywords: ["hotel", "wedding", "photographer"],
  },
  {
    slug: "retail-boutique",
    name: "Retail & Boutique",
    servicesLabel: "Shop the Collection",
    ctaKicker: "Visit the store",
    palette: { primary: "bg-rose-600", secondary: "bg-rose-50", accent: "text-rose-600" },
    keywords: ["boutique", "retail", "shop", "store"],
  },
  {
    slug: "general-business",
    name: "General Business",
    servicesLabel: "Our Services",
    ctaKicker: "Get in touch",
    palette: { primary: "bg-zinc-800", secondary: "bg-zinc-100", accent: "text-zinc-800" },
    keywords: [],
  },
];

/** Picks the first template whose keywords appear in `category` (case-insensitive); falls back to general-business. */
export function selectTemplate(category: string | null): DemoTemplate {
  const lower = (category ?? "").toLowerCase();
  const match = TEMPLATES.find((t) => t.keywords.some((k) => lower.includes(k)));
  return match ?? TEMPLATES[TEMPLATES.length - 1];
}

export function getTemplateBySlug(slug: string): DemoTemplate | undefined {
  return TEMPLATES.find((t) => t.slug === slug);
}
