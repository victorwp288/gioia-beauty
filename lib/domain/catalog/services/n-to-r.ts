import type { CatalogService } from "../types.ts";

import { service, variant } from "../builders.ts";

export const SERVICES_N_TO_R: readonly CatalogService[] = [
  service(
    "nanoblading-grow-brows",
    "ciglia-sopracciglia",
    "Nanoblading grow brows",
    [
      variant(
        "nanoblading-grow-brows-180-min",
        "Nanoblading grow brows",
        180,
        25,
      ),
    ],
  ),
  service("nemesis", "trattamenti-viso", "Nemesis", [
    variant("nemesis-60-min", "Nemesis", 60, 15),
  ]),
  service(
    "ossigeno-dermo-infusione",
    "trattamenti-viso",
    "Ossigeno dermo infusione",
    [
      variant(
        "ossigeno-dermo-infusione-60-min",
        "Ossigeno dermo infusione",
        60,
        15,
      ),
    ],
  ),
  service("pedicure", "pedicure", "Pedicure", [
    variant("pedicure-60-min", "Pedicure", 60, 5),
  ]),
  service("pedicure-spa", "pedicure", "Pedicure SPA", [
    variant("pedicure-spa-60-min", "Pedicure SPA", 60, 15),
  ]),
  service("pedicure-berbero", "pedicure", "Pedicure berbero", [
    variant("pedicure-berbero-75-min", "Pedicure berbero", 75, 10),
  ]),
  service(
    "pedicure-completa-con-cheratolitico",
    "pedicure",
    "Pedicure completa con cheratolitico",
    [
      variant(
        "pedicure-completa-con-cheratolitico-60-min",
        "Pedicure completa con cheratolitico",
        60,
        30,
      ),
    ],
  ),
  service("pedicure-polinesiano", "pedicure", "Pedicure polinesiano", [
    variant("pedicure-polinesiano-75-min", "Pedicure polinesiano", 75, 10),
  ]),
  service("pedicure-siberiano", "pedicure", "Pedicure siberiano", [
    variant("pedicure-siberiano-75-min", "Pedicure siberiano", 75, 10),
  ]),
  service("petto", "ceretta", "Petto", [
    variant("petto-30-min", "Petto", 30, 5),
  ]),
  service("pressoterapia", "massaggi", "Pressoterapia", [
    variant("pressoterapia-30-min", "Pressoterapia 30 minuti", 30, 15),
    variant("pressoterapia-45-min", "Pressoterapia 45 minuti", 45, 15),
  ]),
  service(
    "pulizia-del-viso-con-spatola-ad-ultrasuoni",
    "trattamenti-viso",
    "Pulizia del viso con spatola ad ultrasuoni",
    [
      variant(
        "pulizia-del-viso-con-spatola-ad-ultrasuoni-60-min",
        "Pulizia del viso con spatola ad ultrasuoni",
        60,
        15,
      ),
    ],
  ),
  service(
    "pulizia-del-viso-ultrasuoni-e-mandelico",
    "trattamenti-viso",
    "Pulizia del viso ultrasuoni e mandelico",
    [
      variant(
        "pulizia-del-viso-ultrasuoni-e-mandelico-60-min",
        "Pulizia del viso ultrasuoni e mandelico",
        60,
        15,
      ),
    ],
  ),
  service("rituale-amazzonia", "rituali", "Rituale Amazzonia", [
    variant("rituale-amazzonia-50-min", "50 minuti", 50, 15),
    variant("rituale-amazzonia-60-min", "60 minuti", 60, 15),
    variant("rituale-amazzonia-90-min", "90 minuti", 90, 15),
  ]),
  service("rituale-bora-bora", "rituali", "Rituale Bora Bora", [
    variant("rituale-bora-bora-50-min", "50 minuti", 50, 15),
    variant("rituale-bora-bora-60-min", "60 minuti", 60, 15),
    variant("rituale-bora-bora-90-min", "90 minuti", 90, 15),
  ]),
  service("rituale-coccole-di-cotone", "rituali", "Rituale Coccole di cotone", [
    variant("rituale-coccole-di-cotone-50-min", "50 minuti", 50, 15),
    variant("rituale-coccole-di-cotone-60-min", "60 minuti", 60, 15),
    variant("rituale-coccole-di-cotone-90-min", "90 minuti", 90, 15),
  ]),
  service("rituale-cute", "rituali", "Rituale Cute", [
    variant("rituale-cute-50-min", "50 minuti", 50, 15),
    variant("rituale-cute-60-min", "60 minuti", 60, 15),
    variant("rituale-cute-90-min", "90 minuti", 90, 15),
  ]),
  service("rituale-himalaya", "rituali", "Rituale Himalaya", [
    variant("rituale-himalaya-50-min", "50 minuti", 50, 15),
    variant("rituale-himalaya-60-min", "60 minuti", 60, 15),
    variant("rituale-himalaya-90-min", "90 minuti", 90, 15),
  ]),
  service("rituale-india", "rituali", "Rituale India", [
    variant("rituale-india-50-min", "50 minuti", 50, 15),
    variant("rituale-india-60-min", "60 minuti", 60, 15),
    variant("rituale-india-90-min", "90 minuti", 90, 15),
  ]),
  service("rituale-kleopatra", "rituali", "Rituale Kleopatra", [
    variant("rituale-kleopatra-50-min", "50 minuti", 50, 15),
    variant("rituale-kleopatra-60-min", "60 minuti", 60, 15),
    variant("rituale-kleopatra-90-min", "90 minuti", 90, 15),
  ]),
  service("rituale-kyoto", "rituali", "Rituale Kyoto", [
    variant("rituale-kyoto-50-min", "50 minuti", 50, 15),
    variant("rituale-kyoto-60-min", "60 minuti", 60, 15),
    variant("rituale-kyoto-90-min", "90 minuti", 90, 15),
  ]),
  service("rituale-marrakech", "rituali", "Rituale Marrakech", [
    variant("rituale-marrakech-50-min", "50 minuti", 50, 15),
    variant("rituale-marrakech-60-min", "60 minuti", 60, 15),
    variant("rituale-marrakech-90-min", "90 minuti", 90, 15),
  ]),
  service("rituale-siberia", "rituali", "Rituale Siberia", [
    variant("rituale-siberia-50-min", "50 minuti", 50, 15),
    variant("rituale-siberia-60-min", "60 minuti", 60, 15),
    variant("rituale-siberia-90-min", "90 minuti", 90, 15),
  ]),
];
