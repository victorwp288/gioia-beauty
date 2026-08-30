import {
  BUSINESS_INFO,
  SITE_URL,
  schemaOpeningHours,
} from "@/lib/content/businessInfo";

const localizedSchema = {
  it: {
    description:
      "Centro estetico specializzato in trattamenti viso, corpo, manicure, pedicure e massaggi a Roveleto di Cadeo",
    catalog: "Servizi estetici",
    services: [
      [
        "Trattamenti viso",
        "Pulizia viso, trattamenti anti-età e ossigeno dermo infusione",
      ],
      [
        "Manicure e pedicure",
        "Trattamenti unghie, manicure SPA e pedicure completa",
      ],
      ["Massaggi", "Massaggi viso e corpo personalizzati e pressoterapia"],
      [
        "Ciglia e sopracciglia",
        "Laminazione ciglia, architettura sopracciglia e nanoblading",
      ],
    ],
  },
  en: {
    description:
      "Beauty salon in Roveleto di Cadeo specialising in face and body treatments, manicure, pedicure and massage",
    catalog: "Beauty treatments",
    services: [
      [
        "Face treatments",
        "Facials, anti-ageing treatments and oxygen dermal infusion",
      ],
      [
        "Manicure and pedicure",
        "Nail treatments, SPA manicure and complete pedicure",
      ],
      ["Massage", "Personalised face and body massage and pressotherapy"],
      ["Lashes and brows", "Lash lifts, brow design and nanoblading"],
    ],
  },
};

export function buildBusinessStructuredData(locale = "it") {
  const language = locale === "en" ? "en" : "it";
  const copy = localizedSchema[language];
  return {
    "@context": "https://schema.org",
    "@type": "BeautySalon",
    "@id": `${SITE_URL}/#business`,
    name: BUSINESS_INFO.name,
    legalName: BUSINESS_INFO.legalName,
    description: copy.description,
    image: `${SITE_URL}/ogimage.png`,
    logo: `${SITE_URL}/logo.png`,
    url: SITE_URL,
    telephone: BUSINESS_INFO.phoneE164,
    email: BUSINESS_INFO.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS_INFO.address.street,
      addressLocality: BUSINESS_INFO.address.locality,
      addressRegion: BUSINESS_INFO.address.region,
      postalCode: BUSINESS_INFO.address.postalCode,
      addressCountry: BUSINESS_INFO.address.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: BUSINESS_INFO.geo.latitude,
      longitude: BUSINESS_INFO.geo.longitude,
    },
    openingHours: schemaOpeningHours(),
    hasMap: BUSINESS_INFO.mapsUrl,
    sameAs: [BUSINESS_INFO.instagramUrl],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: copy.catalog,
      itemListElement: copy.services.map(([name, description]) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name, description },
      })),
    },
    founder: {
      "@type": "Person",
      name: BUSINESS_INFO.founder,
      jobTitle:
        language === "en"
          ? "Professional beautician"
          : "Estetista professionista",
    },
  };
}
