export const SITE_URL = "https://www.gioiabeauty.net";

export const BUSINESS_INFO = Object.freeze({
  name: "Gioia Beauty",
  legalName: "Gioia Beauty di Castignoli Gioia",
  founder: "Gioia Castignoli",
  phoneDisplay: "+39 391 421 3634",
  phoneE164: "+393914213634",
  email: "gioiabeautyy@gmail.com",
  vatNumber: "01871820336",
  address: Object.freeze({
    street: "Via Emilia 60",
    postalCode: "29010",
    locality: "Roveleto di Cadeo",
    province: "PC",
    region: "Emilia-Romagna",
    country: "IT",
  }),
  geo: Object.freeze({ latitude: 44.96556, longitude: 9.8514 }),
  hours: Object.freeze([
    Object.freeze({
      days: Object.freeze({ it: "Lunedì, Mercoledì", en: "Monday, Wednesday" }),
      open: "09:00",
      close: "19:00",
      schema: Object.freeze(["Mo 09:00-19:00", "We 09:00-19:00"]),
    }),
    Object.freeze({
      days: Object.freeze({ it: "Martedì, Giovedì", en: "Tuesday, Thursday" }),
      open: "10:00",
      close: "20:00",
      schema: Object.freeze(["Tu 10:00-20:00", "Th 10:00-20:00"]),
    }),
    Object.freeze({
      days: Object.freeze({ it: "Venerdì", en: "Friday" }),
      open: "09:00",
      close: "18:30",
      schema: Object.freeze(["Fr 09:00-18:30"]),
    }),
  ]),
  closedDays: Object.freeze({
    it: "Sabato, Domenica",
    en: "Saturday, Sunday",
  }),
  mapsUrl: "https://maps.app.goo.gl/Vg7QqpUBStAnfnzV7",
  instagramUrl: "https://www.instagram.com/gioiabeautyy/",
  instagramHandle: "@gioiabeautyy",
});

export function formattedAddress({ legal = false } = {}) {
  const { street, postalCode, locality, province } = BUSINESS_INFO.address;
  return legal
    ? `${street} - ${postalCode}, ${locality}, Piacenza (Italia)`
    : `${street}, ${postalCode} ${locality} (${province})`;
}

export function openingHoursSummary(locale = "it") {
  const language = locale === "en" ? "en" : "it";
  const ranges = BUSINESS_INFO.hours.map(
    ({ days, open, close }) => `${days[language]} ${open}–${close}`,
  );
  const closed =
    language === "en"
      ? `${BUSINESS_INFO.closedDays.en} closed`
      : `${BUSINESS_INFO.closedDays.it} chiuso`;
  return `${ranges.join(", ")}. ${closed}.`;
}

export function schemaOpeningHours() {
  return BUSINESS_INFO.hours.flatMap(({ schema }) => schema);
}
