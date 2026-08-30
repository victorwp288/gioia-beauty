import Link from "next/link";

import { SERVICE_CATALOG } from "@/lib/domain/catalog/index.ts";

import {
  SERVICE_DISCOVERY_CATEGORIES,
  categoryContent,
  categoryStats,
  serviceName,
  servicesForCategory,
} from "./serviceDiscoveryContent.js";

function uniqueDurations(service) {
  return [
    ...new Set(
      service.variants
        .filter((variant) => variant.active)
        .map((variant) => variant.serviceDurationMinutes),
    ),
  ].sort((left, right) => left - right);
}

export default function FullServiceCatalog({ locale = "it" }) {
  const english = locale === "en";
  const bookingHref = english ? "/en#booking-section" : "/#booking-section";

  return (
    <main className="bg-[#f8f5f2] pb-20 pt-28 md:pt-36">
      <div className="mx-auto w-[90vw] max-w-6xl">
        <header className="max-w-3xl">
          <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-primary">
            Gioia Beauty · Roveleto di Cadeo
          </p>
          <h1 className="mt-4 font-serif text-4xl leading-tight text-[#3f3a37] md:text-6xl">
            {english ? "Treatment catalogue" : "Catalogo trattamenti"}
          </h1>
          <p className="mt-6 text-base leading-7 text-[#6f6663] md:text-lg">
            {english
              ? `Browse all ${SERVICE_CATALOG.services.length} treatments currently listed by Gioia Beauty. Treatment times are shown below; availability is confirmed during booking.`
              : `Consulta tutti i ${SERVICE_CATALOG.services.length} trattamenti attualmente presenti nel catalogo Gioia Beauty. Le durate sono indicate qui sotto; la disponibilità viene verificata durante la prenotazione.`}
          </p>
        </header>

        <nav
          className="mt-10 flex flex-wrap gap-x-5 gap-y-3 border-y border-[#d9c9c5] py-5"
          aria-label={
            english ? "Treatment categories" : "Categorie di trattamenti"
          }
        >
          {SERVICE_DISCOVERY_CATEGORIES.map((category) => (
            <a
              key={category.id}
              href={`#${category.id}`}
              className="text-sm font-semibold text-[#755e5d] underline-offset-4 hover:text-primary hover:underline"
            >
              {category[locale].title}
            </a>
          ))}
        </nav>

        <div className="mt-12 space-y-5">
          {SERVICE_DISCOVERY_CATEGORIES.map((category, index) => {
            const content = categoryContent(category.id, locale);
            const services = servicesForCategory(category.id);
            return (
              <details
                id={category.id}
                key={category.id}
                open={index === 0}
                className="group scroll-mt-28 border-t border-[#cab8b4] py-2"
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-5 py-6 marker:content-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 [&::-webkit-details-marker]:hidden">
                  <div>
                    <span className="text-[0.68rem] font-semibold tracking-[0.2em] text-[#755e5d]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h2 className="mt-2 font-serif text-3xl text-[#3f3a37]">
                      {content.title}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6f6663]">
                      {content.summary}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                    <span className="text-xs font-semibold uppercase tracking-widest text-[#755e5d]">
                      {categoryStats(category.id, locale)}
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-2xl text-primary transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </div>
                </summary>
                <ul className="grid gap-px overflow-hidden border border-[#ded1ce] bg-[#ded1ce] sm:grid-cols-2 lg:grid-cols-3">
                  {services.map((service) => {
                    const durations = uniqueDurations(service);
                    return (
                      <li key={service.id} className="bg-white p-5">
                        <h3 className="font-serif text-lg leading-snug text-[#3f3a37]">
                          {serviceName(service, locale)}
                        </h3>
                        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#755e5d]">
                          {english ? "Treatment time" : "Durata trattamento"}:{" "}
                          {durations.join(" / ")} min
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>

        <aside className="mt-14 border-l-2 border-primary bg-white px-6 py-7 md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <h2 className="font-serif text-2xl text-[#3f3a37]">
              {english
                ? "Not sure where to start?"
                : "Non sai da dove iniziare?"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6f6663]">
              {english
                ? "Contact Gioia for guidance or choose a treatment in the English booking form."
                : "Contatta Gioia per un consiglio oppure scegli il trattamento nel percorso di prenotazione."}
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-3 md:mt-0 md:shrink-0">
            <Link
              href={english ? "/en/contacts" : "/contacts"}
              className="bg-primary px-5 py-3 text-sm font-bold text-white"
            >
              {english ? "Contact Gioia" : "Contatta Gioia"}
            </Link>
            <Link
              href={bookingHref}
              className="border border-primary px-5 py-3 text-sm font-bold text-primary"
            >
              {english ? "Book online" : "Prenota online"}
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
