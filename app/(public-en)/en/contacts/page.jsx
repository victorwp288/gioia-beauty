import Link from "next/link";
import ClientMap from "@/components/common/ClientMap";
import {
  BUSINESS_INFO,
  formattedAddress,
} from "@/lib/content/businessInfo";
import { buildPublicPageMetadata } from "@/lib/content/seoMetadata";

export const metadata = buildPublicPageMetadata({
  locale: "en",
  title: "Contact",
  description:
    "Contact Gioia Beauty in Roveleto di Cadeo, near Piacenza. Find opening hours, phone, email, Instagram and directions.",
  path: "/en/contacts",
  italianPath: "/contacts",
  englishPath: "/en/contacts",
  imageAlt: "Contact and directions for Gioia Beauty salon",
});

export default function EnglishContacts() {
  return (
    <main className="m-auto mt-24 w-[90vw] animate-fadeIn md:mt-32 md:w-[70vw]">
      <h1 className="font-serif text-3xl font-bold tracking-tight">
        Contact Gioia Beauty
      </h1>
      <div className="grid gap-8 pt-8 md:grid-cols-2">
        <section>
          <h2 className="text-xl font-bold">Opening hours</h2>
          <div className="mt-3 text-sm leading-7">
            {BUSINESS_INFO.hours.map(({ days, open, close }) => (
              <p key={days.en}>
                {days.en} <b>{open}–{close}</b>
              </p>
            ))}
            <p>
              {BUSINESS_INFO.closedDays.en} <b>Closed</b>
            </p>
          </div>
        </section>
        <section>
          <h2 className="text-xl font-bold">Contact details</h2>
          <address className="mt-3 not-italic leading-7">
            <Link
              target="_blank"
              href={BUSINESS_INFO.mapsUrl}
            >
              {formattedAddress()}
            </Link>
            <br />
            <Link className="underline" href={`mailto:${BUSINESS_INFO.email}`}>
              {BUSINESS_INFO.email}
            </Link>
            <br />
            <Link href={`tel:${BUSINESS_INFO.phoneE164}`}>
              {BUSINESS_INFO.phoneDisplay}
            </Link>
            <br />
            <Link
              target="_blank"
              href={BUSINESS_INFO.instagramUrl}
            >
              {BUSINESS_INFO.instagramHandle}
            </Link>
          </address>
        </section>
      </div>
      <ClientMap
        latitude={BUSINESS_INFO.geo.latitude}
        longitude={BUSINESS_INFO.geo.longitude}
        locale="en"
      />
    </main>
  );
}
