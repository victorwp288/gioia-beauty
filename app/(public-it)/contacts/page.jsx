// pages/contacts.js

import React from "react";
import Link from "next/link";
import ClientMap from "@/components/common/ClientMap";
import { BUSINESS_INFO, formattedAddress } from "@/lib/content/businessInfo";
import { buildPublicPageMetadata } from "@/lib/content/seoMetadata";

export const metadata = buildPublicPageMetadata({
  locale: "it",
  title: "Contatti",
  description:
    "Contatta Gioia Beauty a Roveleto di Cadeo per informazioni e prenotazioni. Consulta orari, telefono, email e indicazioni stradali.",
  path: "/contacts",
  italianPath: "/contacts",
  englishPath: "/en/contacts",
  imageAlt: "Contatti e indicazioni per il centro estetico Gioia Beauty",
});

const Contacts = () => {
  const { latitude, longitude } = BUSINESS_INFO.geo;
  return (
    <main className="animate-fadeIn m-auto mt-24 w-[90vw] md:mt-32 md:w-[70vw]">
      <h1 className="font-serif text-3xl font-bold tracking-tight md:text-3xl">
        I nostri contatti
      </h1>
      <div className="grid md:grid-cols-2 pt-8 md:gap-0 gap-8">
        <div className="flex flex-col gap-2 md:gap-4">
          <h2 className=" text-xl font-bold tracking-tight md:text-xl">
            Orari di apertura
          </h2>
          <div>
            {BUSINESS_INFO.hours.map(({ days, open, close }) => (
              <p key={days.it}>
                {days.it}{" "}
                <b>
                  {open} - {close}
                </b>
              </p>
            ))}
            <p>
              {BUSINESS_INFO.closedDays.it} <b>Chiuso</b>
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 md:gap-4">
          <h2 className=" text-xl font-bold tracking-tight md:text-xl">
            Contatti
          </h2>
          <div>
            <Link target="_blank" href={BUSINESS_INFO.mapsUrl}>
              <p>{formattedAddress()}</p>
            </Link>
            <Link className="underline" href={`mailto:${BUSINESS_INFO.email}`}>
              <p>{BUSINESS_INFO.email}</p>
            </Link>
            <Link href={`tel:${BUSINESS_INFO.phoneE164}`}>
              <p>{BUSINESS_INFO.phoneDisplay}</p>
            </Link>
            <Link target="_blank" href={BUSINESS_INFO.instagramUrl}>
              <p>{BUSINESS_INFO.instagramHandle}</p>
            </Link>
          </div>
        </div>
      </div>

      <div>
        <ClientMap latitude={latitude} longitude={longitude} locale="it" />
      </div>
    </main>
  );
};

export default Contacts;
