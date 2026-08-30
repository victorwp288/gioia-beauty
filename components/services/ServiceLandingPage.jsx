import Link from "next/link";
import { BUSINESS_INFO, SITE_URL } from "@/lib/content/businessInfo";

export default function ServiceLandingPage({ entry, locale }) {
  const english = locale === "en";
  const page = english ? entry.en : entry.it;
  const path = english
    ? `/en/services/${entry.en.slug}`
    : `/servizi/${entry.it.slug}`;
  const homePath = english ? "/en" : "/";
  const servicesPath = english ? "/en/services" : "/servizi";
  const breadcrumbLabels = english
    ? ["Home", "Services", page.title]
    : ["Home", "Servizi", page.title];
  const breadcrumbPaths = [homePath, servicesPath, path];
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbLabels.map((name, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name,
          item: `${SITE_URL}${breadcrumbPaths[index]}`,
        })),
      },
      {
        "@type": "Service",
        "@id": `${SITE_URL}${path}#service`,
        name: page.title,
        description: page.description,
        url: `${SITE_URL}${path}`,
        inLanguage: english ? "en" : "it",
        provider: { "@id": `${SITE_URL}/#business` },
        areaServed: {
          "@type": "City",
          name: BUSINESS_INFO.address.locality,
        },
      },
    ],
  };

  return (
    <main className="mx-auto mt-24 w-[90vw] py-12 md:mt-32 md:w-[70vw]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <nav aria-label={english ? "Breadcrumb" : "Percorso di navigazione"}>
        <ol className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <li>
            <Link className="underline" href={homePath}>
              {breadcrumbLabels[0]}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link className="underline" href={servicesPath}>
              {breadcrumbLabels[1]}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{page.title}</li>
        </ol>
      </nav>
      <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">
        Gioia Beauty · Roveleto di Cadeo
      </p>
      <h1 className="mt-3 max-w-4xl font-serif text-4xl font-bold leading-tight md:text-5xl">
        {page.title}
      </h1>
      <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-700">
        {page.intro}
      </p>
      <section
        className="mt-10 rounded-2xl bg-[#f8f5f2] p-7"
        aria-labelledby="included-heading"
      >
        <h2 id="included-heading" className="font-serif text-2xl font-bold">
          {english ? "Available treatments" : "Trattamenti disponibili"}
        </h2>
        <ul className="mt-5 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
          {page.details.map((detail) => (
            <li key={detail} className="rounded-xl bg-white p-4">
              {detail}
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-10" aria-labelledby="catalog-heading">
        <h2 id="catalog-heading" className="font-serif text-2xl font-bold">
          {english
            ? "Selected catalogue options"
            : "Una selezione dal catalogo"}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          {page.catalogIntro}
        </p>
        <dl className="mt-5 grid gap-3 md:grid-cols-2">
          {page.treatments.map(([name, duration]) => (
            <div
              key={name}
              className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"
            >
              <dt className="font-medium">{name}</dt>
              <dd className="shrink-0 text-sm text-slate-500">{duration}</dd>
            </div>
          ))}
        </dl>
      </section>
      <p className="mt-8 max-w-3xl text-sm leading-6 text-slate-600">
        {english
          ? "Treatment suitability, duration and availability are confirmed directly with Gioia before booking."
          : "Idoneità, durata e disponibilità del trattamento vengono confermate direttamente con Gioia prima della prenotazione."}
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href={english ? "/en/contacts" : "/contacts"}
          className="rounded-sm bg-primary px-5 py-3 font-semibold text-white"
        >
          {english ? "Contact Gioia Beauty" : "Contatta Gioia Beauty"}
        </Link>
        <Link
          href={english ? "/en#booking-section" : "/#booking-section"}
          className="rounded-sm border border-primary px-5 py-3 font-semibold text-primary"
        >
          {english ? "Book online" : "Prenota online"}
        </Link>
      </div>
    </main>
  );
}
