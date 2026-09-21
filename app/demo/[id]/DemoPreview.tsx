import { getTemplateBySlug, TEMPLATES } from "@/lib/templates/registry";
import type { DemoContentOutput } from "@/lib/validation/schemas";

export default function DemoPreview({ businessName, content }: { businessName: string; content: DemoContentOutput }) {
  const template = getTemplateBySlug(content.templateSlug) ?? TEMPLATES[TEMPLATES.length - 1];
  const { primary, secondary, accent } = template.palette;

  return (
    <div className="min-h-screen bg-white">
      <header className={`${primary} px-6 py-24 text-center text-white`}>
        <p className="text-sm font-semibold uppercase tracking-wide opacity-80">{content.tagline}</p>
        <h1 className="mt-3 text-4xl font-bold sm:text-5xl">{content.heroHeadline}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg opacity-90">{content.heroSubheadline}</p>
        <button className="mt-8 rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-900">
          {content.ctaText}
        </button>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className={`text-2xl font-semibold ${accent}`}>About {businessName}</h2>
        <p className="mt-4 text-zinc-600">{content.aboutText}</p>
      </section>

      <section className={`${secondary} px-6 py-16`}>
        <div className="mx-auto max-w-5xl">
          <h2 className={`text-center text-2xl font-semibold ${accent}`}>{template.servicesLabel}</h2>
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {content.services.map((service, i) => (
              <div key={i} className="rounded-lg bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-zinc-900">{service.title}</h3>
                <p className="mt-2 text-sm text-zinc-600">{service.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-16">
        <h2 className={`text-center text-2xl font-semibold ${accent}`}>Why Choose Us</h2>
        <ul className="mx-auto mt-6 max-w-lg list-inside list-disc space-y-2 text-zinc-600">
          {content.whyChooseUs.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      </section>

      <footer className={`${primary} px-6 py-14 text-center text-white`}>
        <h2 className="text-2xl font-semibold">{content.ctaText}</h2>
        <div className="mt-4 space-y-1 text-sm opacity-90">
          {content.contactInfo.address && <p>{content.contactInfo.address}</p>}
          <p>{[content.contactInfo.city].filter(Boolean).join(", ")}</p>
          {content.contactInfo.phone && <p>{content.contactInfo.phone}</p>}
        </div>
        <p className="mt-6 text-xs uppercase tracking-wide opacity-60">
          Design style: {content.designStyle} · Template: {template.name}
        </p>
      </footer>
    </div>
  );
}
