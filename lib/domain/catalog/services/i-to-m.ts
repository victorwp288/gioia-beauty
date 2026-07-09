import type { CatalogService } from "../types.ts";

import { service, variant } from "../builders.ts";

export const SERVICES_I_TO_M: readonly CatalogService[] = [
  service("inguine-parziale", "ceretta", "Inguine parziale", [
    variant("inguine-parziale-20-min", "Inguine parziale", 20, 5),
  ]),
  service("inguine-totale", "ceretta", "Inguine totale", [
    variant("inguine-totale-30-min", "Inguine totale", 30, 5),
  ]),
  service("laminazione-ciglia", "ciglia-sopracciglia", "Laminazione ciglia", [
    variant("laminazione-ciglia-60-min", "Laminazione ciglia", 60, 5),
  ]),
  service(
    "laminazione-sopracciglia",
    "ciglia-sopracciglia",
    "Laminazione sopracciglia",
    [
      variant(
        "laminazione-sopracciglia-60-min",
        "Laminazione sopracciglia",
        60,
        5,
      ),
    ],
  ),
  service("manicure", "manicure", "Manicure", [
    variant("manicure-30-min", "Manicure", 30, 5),
  ]),
  service("manicure-giapponese", "manicure", "Manicure Giapponese", [
    variant("manicure-giapponese-45-min", "Manicure Giapponese", 45, 5),
  ]),
  service("manicure-spa", "manicure", "Manicure SPA", [
    variant("manicure-spa-50-min", "Manicure SPA", 50, 5),
  ]),
  service("massaggio-con-pindasweda", "massaggi", "Massaggio con Pindasweda", [
    variant(
      "massaggio-con-pindasweda-30-min",
      "Massaggio Pindasweda 30 minuti",
      30,
      15,
    ),
    variant(
      "massaggio-con-pindasweda-50-min",
      "Massaggio Pindasweda 50 minuti",
      50,
      15,
    ),
  ]),
  service(
    "massaggio-corpo-al-cioccolato",
    "massaggi",
    "Massaggio corpo al cioccolato",
    [
      variant(
        "massaggio-corpo-al-cioccolato-45-min",
        "Massaggio corpo al cioccolato",
        45,
        15,
      ),
    ],
  ),
  service(
    "massaggio-corpo-personalizzato",
    "massaggi",
    "Massaggio corpo personalizzato",
    [
      variant(
        "massaggio-corpo-personalizzato-30-min",
        "Massaggio 30 minuti",
        30,
        15,
      ),
      variant(
        "massaggio-corpo-personalizzato-60-min",
        "Massaggio 60 minuti",
        60,
        15,
      ),
    ],
  ),
  service(
    "massaggio-viso-personalizzato",
    "massaggi",
    "Massaggio viso personalizzato",
    [
      variant(
        "massaggio-viso-personalizzato-30-min",
        "Massaggio viso personalizzato",
        30,
        5,
      ),
    ],
  ),
  service("mezza-gamba", "ceretta", "Mezza gamba", [
    variant("mezza-gamba-45-min", "Mezza gamba", 45, 5),
  ]),
];
