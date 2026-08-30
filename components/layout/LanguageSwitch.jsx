"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const routePairs = [
  ["/", "/en"],
  ["/gallery", "/en/gallery"],
  ["/contacts", "/en/contacts"],
  ["/policy", "/en/privacy"],
  ["/servizi", "/en/services"],
  ["/servizi/trattamenti-viso", "/en/services/face-treatments"],
  ["/servizi/epilazione-laser", "/en/services/laser-hair-removal"],
  ["/servizi/manicure-pedicure", "/en/services/manicure-pedicure"],
  ["/servizi/massaggi", "/en/services/massage"],
  ["/servizi/ciglia-sopracciglia", "/en/services/lashes-brows"],
];

export default function LanguageSwitch({ locale, className = "", onClick }) {
  const pathname = usePathname();
  const pair = routePairs.find(([italian, english]) =>
    locale === "en" ? english === pathname : italian === pathname,
  );
  const href = pair
    ? locale === "en"
      ? pair[0]
      : pair[1]
    : locale === "en"
      ? "/"
      : "/en";
  const nextLocale = locale === "en" ? "it" : "en";

  return (
    <Link
      href={href}
      hrefLang={nextLocale}
      lang={nextLocale}
      className={className}
      onClick={onClick}
    >
      {locale === "en" ? "Italiano" : "English"}
    </Link>
  );
}
