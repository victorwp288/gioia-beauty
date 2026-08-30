import Link from "next/link";
import { BUSINESS_INFO } from "@/lib/content/businessInfo";

export default function EnglishBookingIntro() {
  return (
    <section
      id="booking-section"
      className="mx-auto w-[90vw] scroll-mt-24 py-14 md:w-[70vw]"
      aria-labelledby="booking-heading"
    >
      <p className="text-xs font-extrabold uppercase text-primary">
        Take time for yourself
      </p>
      <h2 id="booking-heading" className="mt-2 font-serif text-3xl font-bold">
        Book an appointment
      </h2>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
        The online booking form currently uses the salon’s Italian treatment
        catalogue. You can use it safely, or contact Gioia directly in English.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/#booking-section"
          hrefLang="it"
          className="rounded-sm bg-primary px-5 py-3 font-semibold text-white"
        >
          Open online booking
        </Link>
        <Link
          href={`tel:${BUSINESS_INFO.phoneE164}`}
          className="rounded-sm border border-primary px-5 py-3 font-semibold text-primary"
        >
          Call {BUSINESS_INFO.phoneDisplay}
        </Link>
        <Link
          href={`mailto:${BUSINESS_INFO.email}`}
          className="rounded-sm border border-primary px-5 py-3 font-semibold text-primary"
        >
          Email Gioia Beauty
        </Link>
      </div>
    </section>
  );
}
