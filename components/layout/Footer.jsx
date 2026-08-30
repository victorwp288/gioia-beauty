import Link from "next/link";
import { BUSINESS_INFO, formattedAddress } from "@/lib/content/businessInfo";

const copyByLocale = {
  it: {
    mondayWednesday: "Lunedì, Mercoledì",
    tuesdayThursday: "Martedì, Giovedì",
    friday: "Venerdì",
    weekend: "Sabato, Domenica",
    closed: "Chiuso",
    privacy: "Privacy policy",
    privacyHref: "/policy",
  },
  en: {
    mondayWednesday: "Monday, Wednesday",
    tuesdayThursday: "Tuesday, Thursday",
    friday: "Friday",
    weekend: "Saturday, Sunday",
    closed: "Closed",
    privacy: "Privacy policy (Italian)",
    privacyHref: "/en/privacy",
  },
};

function Footer({ locale = "it" }) {
  const copy = copyByLocale[locale] || copyByLocale.it;
  const language = locale === "en" ? "en" : "it";
  return (
    <footer className="relative z-0 pb-10 pl-6 text-sm text-[#59514f] md:mt-12 md:px-64">
      <div className="grid md:grid-cols-3 pt-8 md:gap-0 gap-8">
        <div className="flex flex-col gap-2 md:gap-4">
          <div>
            {BUSINESS_INFO.hours.map(({ days, open, close }) => (
              <p key={days.it}>
                {days[language]}{" "}
                <b>
                  {open} - {close}
                </b>
              </p>
            ))}
            <p>
              {BUSINESS_INFO.closedDays[language]} <b>{copy.closed}</b>
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 md:gap-4">
          <address className="flex flex-col not-italic">
            <Link
              target="_blank"
              href={BUSINESS_INFO.mapsUrl}
              rel="noopener noreferrer"
              className="flex min-h-11 items-center rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
            >
              {formattedAddress()}
            </Link>
            <Link
              className="flex min-h-11 items-center break-all underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
              href={`mailto:${BUSINESS_INFO.email}`}
            >
              {BUSINESS_INFO.email}
            </Link>
            <Link
              href={`tel:${BUSINESS_INFO.phoneE164}`}
              className="flex min-h-11 items-center rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
            >
              {BUSINESS_INFO.phoneDisplay}
            </Link>
            <Link
              target="_blank"
              href={BUSINESS_INFO.instagramUrl}
              rel="noopener noreferrer"
              className="flex min-h-11 items-center rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
            >
              {BUSINESS_INFO.instagramHandle}
            </Link>
          </address>
        </div>

        <div>
          <p>P. IVA {BUSINESS_INFO.vatNumber}</p>
          <br />
          <Link
            className="flex min-h-11 items-center underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#76575c] focus-visible:ring-offset-2"
            href={copy.privacyHref}
          >
            {copy.privacy}
          </Link>
          <p>© Gioia Beauty</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
