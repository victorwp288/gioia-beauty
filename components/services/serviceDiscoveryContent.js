import { SERVICE_CATALOG } from "@/lib/domain/catalog/index.ts";

export const SERVICE_DISCOVERY_GROUPS = [
  {
    id: "skin-body",
    it: "Viso, corpo e tecnologia",
    en: "Skin, body and technology",
  },
  { id: "detail", it: "Cura e definizione", en: "Care and definition" },
  { id: "ritual", it: "Rituali e relax", en: "Rituals and relaxation" },
];

export const SERVICE_DISCOVERY_CATEGORIES = [
  {
    id: "trattamenti-viso",
    group: "skin-body",
    it: {
      title: "Trattamenti viso",
      summary: "Pulizia, ossigeno dermo infusione e protocolli viso mirati.",
    },
    en: {
      title: "Face treatments",
      summary:
        "Cleansing, oxygen dermal infusion and targeted face treatments.",
    },
  },
  {
    id: "trattamenti-corpo",
    group: "skin-body",
    it: {
      title: "Trattamenti corpo",
      summary: "Bendaggi e protocolli corpo con durate definite nel catalogo.",
    },
    en: {
      title: "Body treatments",
      summary: "Body wraps and treatments with clearly listed durations.",
    },
  },
  {
    id: "massaggi",
    group: "skin-body",
    it: {
      title: "Massaggi",
      summary:
        "Massaggi personalizzati, pressoterapia, scrub e rituali hammam.",
    },
    en: {
      title: "Massage and body care",
      summary:
        "Personalised massage, pressotherapy, scrubs and hammam rituals.",
    },
  },
  {
    id: "lpg",
    group: "skin-body",
    it: {
      title: "LPG Endermologie",
      summary:
        "Consulenza e trattamenti Detox e Attivatore splendore immediato.",
    },
    en: {
      title: "LPG Endermologie",
      summary:
        "Consultation, Detox and Immediate Radiance Activator treatments.",
    },
  },
  {
    id: "laser",
    group: "skin-body",
    it: {
      title: "Laser",
      summary: "Una consulenza dedicata per valutare il percorso laser.",
    },
    en: {
      title: "Laser",
      summary: "A dedicated consultation to assess your laser treatment plan.",
    },
  },
  {
    id: "manicure",
    group: "detail",
    it: {
      title: "Manicure",
      summary: "Manicure, smalto classico, semipermanente, gel e cura SPA.",
    },
    en: {
      title: "Manicure",
      summary: "Manicure, classic and semi-permanent polish, gel and SPA care.",
    },
  },
  {
    id: "pedicure",
    group: "detail",
    it: {
      title: "Pedicure",
      summary:
        "Pedicure completa e rituali SPA, berbero, polinesiano e siberiano.",
    },
    en: {
      title: "Pedicure",
      summary:
        "Complete pedicure and SPA, Berber, Polynesian and Siberian rituals.",
    },
  },
  {
    id: "ciglia-sopracciglia",
    group: "detail",
    it: {
      title: "Ciglia e sopracciglia",
      summary: "Laminazione, architettura, filo arabo, Grow Up e nanoblading.",
    },
    en: {
      title: "Lashes and brows",
      summary: "Lamination, brow design, threading, Grow Up and nanoblading.",
    },
  },
  {
    id: "ceretta",
    group: "detail",
    it: {
      title: "Ceretta",
      summary: "Trattamenti viso e corpo organizzati per zona.",
    },
    en: {
      title: "Waxing",
      summary: "Face and body waxing organised by treatment area.",
    },
  },
  {
    id: "makeup",
    group: "detail",
    it: {
      title: "Make-up",
      summary: "Corso individuale di make-up base di 120 minuti.",
    },
    en: {
      title: "Make-up",
      summary: "A 120-minute one-to-one basic make-up course.",
    },
  },
  {
    id: "bagno-turco",
    group: "ritual",
    it: {
      title: "Bagno turco",
      summary: "Una seduta di bagno turco di 60 minuti.",
    },
    en: {
      title: "Steam bath",
      summary: "A 60-minute steam bath session.",
    },
  },
  {
    id: "rituali",
    group: "ritual",
    it: {
      title: "Rituali dal mondo",
      summary: "Undici rituali e scrub con percorsi da 30 a 90 minuti.",
    },
    en: {
      title: "World-inspired rituals",
      summary: "Eleven rituals and scrubs with options from 30 to 90 minutes.",
    },
  },
];

export const ENGLISH_SERVICE_NAMES = {
  "seduta-di-bagno-turco": "Steam bath session",
  ascelle: "Underarms",
  baffetti: "Upper lip",
  "baffetti-e-sopracciglia": "Upper lip and eyebrows",
  braccia: "Arms",
  "gamba-intera": "Full leg",
  "gamba-intera-uomo": "Men’s full leg",
  glutei: "Buttocks",
  "inguine-parziale": "Bikini line",
  "inguine-totale": "Full bikini",
  "mezza-gamba": "Half leg",
  petto: "Chest",
  schiena: "Back",
  sopracciglia: "Eyebrows",
  "architettura-sopracciglia": "Brow design",
  "combinazione-laminazione-ciglia-e-sopracciglia":
    "Combined lash and brow lamination",
  "epilazione-con-filo-arabo-delle-sopracciglia": "Eyebrow threading",
  "grow-up-sopracciglia": "Grow Up brows",
  "laminazione-ciglia": "Lash lamination",
  "laminazione-sopracciglia": "Brow lamination",
  "nanoblading-grow-brows": "Nanoblading Grow Brows",
  "consulenza-laser": "Laser consultation",
  "attivatore-splendore-immediato": "Immediate Radiance Activator",
  "consulenza-endermologie": "Endermologie consultation",
  detox: "Detox",
  "corso-individuale-di-make-up-base": "One-to-one basic make-up course",
  "applicazione-di-smalto-semipermanente": "Semi-permanent polish application",
  "applicazione-di-smalto-semipermanente-rinforzato":
    "Reinforced semi-permanent polish application",
  "applicazione-smalto-classico": "Classic polish application",
  "copertura-gel-delle-unghie-naturali": "Natural nail gel overlay",
  manicure: "Manicure",
  "manicure-giapponese": "Japanese manicure",
  "manicure-spa": "SPA manicure",
  "body-brushing-mineralizzante": "Mineralising body brushing",
  "massaggio-con-pindasweda": "Pindasweda massage",
  "massaggio-corpo-al-cioccolato": "Chocolate body massage",
  "massaggio-corpo-personalizzato": "Personalised body massage",
  "massaggio-viso-personalizzato": "Personalised face massage",
  pressoterapia: "Pressotherapy",
  "savonage-hammam": "Hammam savonage",
  "scrub-al-te-verde": "Green tea scrub",
  "scrub-drenante-al-sale-integrale": "Draining whole-sea-salt scrub",
  pedicure: "Pedicure",
  "pedicure-spa": "SPA pedicure",
  "pedicure-berbero": "Berber pedicure",
  "pedicure-completa-con-cheratolitico": "Complete keratolytic pedicure",
  "pedicure-polinesiano": "Polynesian pedicure",
  "pedicure-siberiano": "Siberian pedicure",
  "rituale-amazzonia": "Amazonia ritual",
  "rituale-bora-bora": "Bora Bora ritual",
  "rituale-coccole-di-cotone": "Cotton Caress ritual",
  "rituale-cute": "Cute ritual",
  "rituale-himalaya": "Himalaya ritual",
  "rituale-india": "India ritual",
  "rituale-kleopatra": "Kleopatra ritual",
  "rituale-kyoto": "Kyoto ritual",
  "rituale-marrakech": "Marrakech ritual",
  "rituale-siberia": "Siberia ritual",
  "scrub-corpo-aromatico": "Aromatic body scrub",
  "bendaggio-specifico": "Targeted body wrap",
  "calcoterapia-decongestionante-rassodante":
    "Decongesting and firming calcotherapy",
  salagione: "Salagione treatment",
  "snellente-localizzato-cacao-e-calco-termico":
    "Localised cacao and thermal cast treatment",
  "thalassa-alga-gigante": "Giant algae thalassotherapy",
  "trattamento-artico-gambe": "Arctic leg treatment",
  "trattamento-minerale-al-limo-di-salina": "Salt-pan mud mineral treatment",
  "elite-active": "Elite Active",
  nemesis: "Nemesis",
  "ossigeno-dermo-infusione": "Oxygen dermal infusion",
  "pulizia-del-viso-con-spatola-ad-ultrasuoni":
    "Facial cleansing with an ultrasonic spatula",
  "pulizia-del-viso-ultrasuoni-e-mandelico":
    "Ultrasonic and mandelic acid facial cleansing",
  "trattamenti-viso-specifici": "Targeted face treatments",
  "trattamento-viso-eterna": "Eterna face treatment",
  "trattamento-viso-fast-beauty": "Fast Beauty face treatment",
};

const CATEGORY_BY_ID = new Map(
  SERVICE_DISCOVERY_CATEGORIES.map((category) => [category.id, category]),
);

export function catalogHref(locale) {
  return locale === "en" ? "/en/services" : "/servizi";
}

export function categoryHref(categoryId, locale) {
  return `${catalogHref(locale)}#${categoryId}`;
}

export function categoryContent(categoryId, locale) {
  return CATEGORY_BY_ID.get(categoryId)?.[locale] ?? null;
}

export function serviceName(service, locale) {
  return locale === "en"
    ? (ENGLISH_SERVICE_NAMES[service.id] ?? service.nameIt)
    : service.nameIt;
}

export function servicesForCategory(categoryId) {
  return SERVICE_CATALOG.services.filter(
    (service) => service.active && service.categoryId === categoryId,
  );
}

export function categoryStats(categoryId, locale) {
  const services = servicesForCategory(categoryId);
  const durations = services.flatMap((service) =>
    service.variants
      .filter((variant) => variant.active)
      .map((variant) => variant.serviceDurationMinutes),
  );
  const count = services.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  if (locale === "en") {
    return `${count} ${count === 1 ? "treatment" : "treatments"} · ${min}${min === max ? "" : `–${max}`} min`;
  }
  return `${count} ${count === 1 ? "trattamento" : "trattamenti"} · ${min}${min === max ? "" : `–${max}`} min`;
}

export function assertCompleteServiceDiscovery() {
  const activeCategories = SERVICE_CATALOG.categories.filter(
    (category) => category.active,
  );
  const representedCategories = new Set(
    SERVICE_DISCOVERY_CATEGORIES.map((category) => category.id),
  );
  const activeServices = SERVICE_CATALOG.services.filter(
    (service) => service.active,
  );
  const translatedServices = new Set(Object.keys(ENGLISH_SERVICE_NAMES));

  return {
    categoriesComplete:
      activeCategories.length === representedCategories.size &&
      activeCategories.every((category) =>
        representedCategories.has(category.id),
      ),
    servicesComplete:
      activeServices.length === translatedServices.size &&
      activeServices.every((service) => translatedServices.has(service.id)),
  };
}
