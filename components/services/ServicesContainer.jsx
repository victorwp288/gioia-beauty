import Link from "next/link";

import {
  SERVICE_DISCOVERY_CATEGORIES,
  SERVICE_DISCOVERY_GROUPS,
  catalogHref,
  categoryHref,
  categoryStats,
} from "./serviceDiscoveryContent.js";

function CategoryLink({ category, index, locale }) {
  const content = category[locale];
  const stats = categoryStats(category.id, locale);

  return (
    <Link
      href={categoryHref(category.id, locale)}
      className="group relative grid min-h-44 grid-rows-[auto_1fr_auto] border-t border-[#d9c9c5] py-5 transition-colors hover:border-[#8f6d70] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4"
    >
      <span className="text-[0.68rem] font-semibold tracking-[0.2em] text-[#755e5d]">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="pt-5">
        <h3 className="font-serif text-2xl leading-tight text-[#3f3a37] transition-colors group-hover:text-primary">
          {content.title}
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-[#6f6663]">
          {content.summary}
        </p>
      </div>
      <div className="mt-5 flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.12em] text-[#755e5d]">
        <span>{stats}</span>
        <span
          aria-hidden="true"
          className="text-base transition-transform group-hover:translate-x-1"
        >
          →
        </span>
      </div>
    </Link>
  );
}

export default function ServicesContainer({ locale = "it" }) {
  const english = locale === "en";

  return (
    <section
      className="bg-[#f8f5f2] py-16 md:py-24"
      aria-labelledby={`${locale}-services-heading`}
    >
      <div className="mx-auto w-[90vw] max-w-6xl">
        <div className="grid gap-6 border-b border-[#d9c9c5] pb-10 md:grid-cols-[0.75fr_1.25fr] md:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-primary">
              {english ? "12 treatment areas" : "12 aree di trattamento"}
            </p>
            <h2
              id={`${locale}-services-heading`}
              className="mt-3 max-w-lg font-serif text-4xl leading-[1.08] text-[#3f3a37] md:text-5xl"
            >
              {english
                ? "Find the care that feels right for you"
                : "Trova la cura giusta per te"}
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-[#6f6663] md:justify-self-end md:text-base">
            {english
              ? "Explore Gioia Beauty’s complete treatment range, from everyday care to dedicated face, body and wellbeing rituals. Each area links to the full current catalogue."
              : "Esplora l’intera proposta Gioia Beauty: dalla cura quotidiana ai percorsi dedicati a viso, corpo e benessere. Ogni area porta al catalogo completo e aggiornato."}
          </p>
        </div>

        <div className="space-y-14 pt-10">
          {SERVICE_DISCOVERY_GROUPS.map((group) => {
            const categories = SERVICE_DISCOVERY_CATEGORIES.filter(
              (category) => category.group === group.id,
            );
            return (
              <section key={group.id} aria-labelledby={`${locale}-${group.id}`}>
                <h3
                  id={`${locale}-${group.id}`}
                  className="text-xs font-bold uppercase tracking-[0.2em] text-[#766865]"
                >
                  {group[locale]}
                </h3>
                <div className="mt-4 grid gap-x-8 md:grid-cols-2 lg:grid-cols-3">
                  {categories.map((category) => (
                    <CategoryLink
                      key={category.id}
                      category={category}
                      index={SERVICE_DISCOVERY_CATEGORIES.findIndex(
                        (candidate) => candidate.id === category.id,
                      )}
                      locale={locale}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-[#d9c9c5] pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-[#6f6663]">
            {english
              ? "Names and treatment times come directly from the current booking catalogue."
              : "Nomi e durate dei trattamenti provengono direttamente dal catalogo di prenotazione."}
          </p>
          <Link
            href={catalogHref(locale)}
            className="w-fit border-b border-primary pb-1 text-sm font-bold text-primary transition-colors hover:text-[#795b5e]"
          >
            {english ? "View all treatments" : "Vedi tutti i trattamenti"} →
          </Link>
        </div>
      </div>
    </section>
  );
}
