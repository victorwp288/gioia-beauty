import type { CatalogService } from "../types.ts";

import { service, variant } from "../builders.ts";

export const SERVICES_S_TO_Z: readonly CatalogService[] = [
  service("salagione", "trattamenti-corpo", "Salagione", [
    variant("salagione-60-min", "Salagione", 60, 15),
  ]),
  service("savonage-hammam", "massaggi", "Savonage hammam", [
    variant("savonage-hammam-50-min", "Savonage hammam 50 minuti", 50, 15),
    variant("savonage-hammam-90-min", "Savonage hammam 90 minuti", 90, 15),
  ]),
  service("schiena", "ceretta", "Schiena", [
    variant("schiena-60-min", "Schiena", 60, 5),
  ]),
  service("scrub-al-te-verde", "massaggi", "Scrub al tè verde", [
    variant("scrub-al-te-verde-50-min", "Scrub al tè verde 50 minuti", 50, 15),
    variant("scrub-al-te-verde-90-min", "Scrub al tè verde 90 minuti", 90, 15),
  ]),
  service("scrub-corpo-aromatico", "rituali", "Scrub corpo aromatico", [
    variant("scrub-corpo-aromatico-30-min", "30 minuti", 30, 15),
    variant("scrub-corpo-aromatico-60-min", "60 minuti", 60, 15),
  ]),
  service(
    "scrub-drenante-al-sale-integrale",
    "massaggi",
    "Scrub drenante al sale integrale",
    [
      variant(
        "scrub-drenante-al-sale-integrale-50-min",
        "Scrub drenante 50 minuti",
        50,
        15,
      ),
      variant(
        "scrub-drenante-al-sale-integrale-90-min",
        "Scrub drenante 90 minuti",
        90,
        15,
      ),
    ],
  ),
  service("seduta-di-bagno-turco", "bagno-turco", "Seduta di Bagno Turco", [
    variant("seduta-di-bagno-turco-60-min", "Seduta di Bagno Turco", 60, 15),
  ]),
  service(
    "snellente-localizzato-cacao-e-calco-termico",
    "trattamenti-corpo",
    "Snellente localizzato cacao e calco termico",
    [
      variant(
        "snellente-localizzato-cacao-e-calco-termico-75-min",
        "Snellente localizzato cacao e calco termico",
        75,
        15,
      ),
    ],
  ),
  service("sopracciglia", "ceretta", "Sopracciglia", [
    variant("sopracciglia-15-min", "Sopracciglia", 15, 5),
  ]),
  service(
    "thalassa-alga-gigante",
    "trattamenti-corpo",
    "Thalassa alga gigante",
    [variant("thalassa-alga-gigante-90-min", "Thalassa alga gigante", 90, 15)],
  ),
  service(
    "trattamenti-viso-specifici",
    "trattamenti-viso",
    "Trattamenti viso specifici",
    [
      variant(
        "trattamenti-viso-specifici-60-min",
        "Trattamenti viso specifici",
        60,
        15,
      ),
    ],
  ),
  service(
    "trattamento-artico-gambe",
    "trattamenti-corpo",
    "Trattamento artico gambe",
    [
      variant(
        "trattamento-artico-gambe-60-min",
        "Trattamento artico gambe",
        60,
        15,
      ),
    ],
  ),
  service(
    "trattamento-minerale-al-limo-di-salina",
    "trattamenti-corpo",
    "Trattamento minerale al limo di salina",
    [
      variant(
        "trattamento-minerale-al-limo-di-salina-60-min",
        "Trattamento minerale al limo di salina",
        60,
        15,
      ),
    ],
  ),
  service(
    "trattamento-viso-eterna",
    "trattamenti-viso",
    "Trattamento viso Eterna",
    [
      variant(
        "trattamento-viso-eterna-90-min",
        "Trattamento viso Eterna",
        90,
        15,
      ),
    ],
  ),
  service(
    "trattamento-viso-fast-beauty",
    "trattamenti-viso",
    "Trattamento viso Fast Beauty",
    [
      variant(
        "trattamento-viso-fast-beauty-30-min",
        "Trattamento viso Fast Beauty",
        30,
        15,
      ),
    ],
  ),
];
