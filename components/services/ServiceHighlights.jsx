import Link from "next/link";
import { servicePages } from "@/lib/content/servicePages";

export default function ServiceHighlights() {
  return (
    <nav
      className="mx-auto w-[90vw] py-10 md:w-[70vw]"
      aria-label="Approfondimenti sui trattamenti"
    >
      <h2 className="font-serif text-2xl font-bold">
        Scopri i trattamenti più richiesti
      </h2>
      <div className="mt-5 flex flex-wrap gap-3">
        {servicePages.map((page) => (
          <Link
            key={page.key}
            href={`/servizi/${page.it.slug}`}
            className="rounded-full border border-[#d9c6c8] px-4 py-2 text-sm font-semibold text-[#6f5559] transition hover:bg-[#f8eff0]"
          >
            {page.it.title.replace(" a Roveleto di Cadeo", "")}
          </Link>
        ))}
      </div>
    </nav>
  );
}
