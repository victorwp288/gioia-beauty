import type { CatalogService } from "../types.ts";

import { service, variant } from "../builders.ts";

export const SERVICES_A_TO_G: readonly CatalogService[] = [
  service(
    "applicazione-di-smalto-semipermanente",
    "manicure",
    "Applicazione di smalto semipermanente",
    [
      variant(
        "applicazione-di-smalto-semipermanente-60-min",
        "Applicazione di smalto semipermanente",
        60,
        5,
      ),
    ],
  ),
  service(
    "applicazione-di-smalto-semipermanente-rinforzato",
    "manicure",
    "Applicazione di smalto semipermanente rinforzato",
    [
      variant(
        "applicazione-di-smalto-semipermanente-rinforzato-90-min",
        "Applicazione di smalto semipermanente rinforzato",
        90,
        5,
      ),
    ],
  ),
  service(
    "applicazione-smalto-classico",
    "manicure",
    "Applicazione smalto classico",
    [
      variant(
        "applicazione-smalto-classico-45-min",
        "Applicazione smalto classico",
        45,
        5,
      ),
    ],
  ),
  service(
    "architettura-sopracciglia",
    "ciglia-sopracciglia",
    "Architettura sopracciglia",
    [
      variant(
        "architettura-sopracciglia-40-min",
        "Architettura sopracciglia",
        40,
        5,
      ),
    ],
  ),
  service("ascelle", "ceretta", "Ascelle", [
    variant("ascelle-25-min", "Ascelle", 25, 5),
  ]),
  service(
    "attivatore-splendore-immediato",
    "lpg",
    "Attivatore splendore immediato",
    [
      variant(
        "attivatore-splendore-immediato-60-min",
        "Attivatore splendore immediato",
        60,
        5,
      ),
    ],
  ),
  service("baffetti", "ceretta", "Baffetti", [
    variant("baffetti-15-min", "Baffetti", 15, 5),
  ]),
  service("baffetti-e-sopracciglia", "ceretta", "Baffetti e sopracciglia", [
    variant(
      "baffetti-e-sopracciglia-10-min",
      "Baffetti e sopracciglia",
      10,
      10,
    ),
  ]),
  service("bendaggio-specifico", "trattamenti-corpo", "Bendaggio specifico", [
    variant("bendaggio-specifico-60-min", "Bendaggio specifico", 60, 15),
  ]),
  service(
    "body-brushing-mineralizzante",
    "massaggi",
    "Body brushing mineralizzante",
    [
      variant(
        "body-brushing-mineralizzante-50-min",
        "Body brushing 50 minuti",
        50,
        15,
      ),
      variant(
        "body-brushing-mineralizzante-90-min",
        "Body brushing 90 minuti",
        90,
        15,
      ),
    ],
  ),
  service("braccia", "ceretta", "Braccia", [
    variant("braccia-15-min", "Braccia", 15, 5),
  ]),
  service(
    "calcoterapia-decongestionante-rassodante",
    "trattamenti-corpo",
    "Calcoterapia decongestionante-rassodante",
    [
      variant(
        "calcoterapia-decongestionante-rassodante-60-min",
        "Calcoterapia decongestionante-rassodante",
        60,
        15,
      ),
    ],
  ),
  service(
    "combinazione-laminazione-ciglia-e-sopracciglia",
    "ciglia-sopracciglia",
    "Combinazione laminazione ciglia e sopracciglia",
    [
      variant(
        "combinazione-laminazione-ciglia-e-sopracciglia-70-min",
        "Combinazione laminazione ciglia e sopracciglia",
        70,
        5,
      ),
    ],
  ),
  service("consulenza-endermologie", "lpg", "Consulenza endermologie®", [
    variant(
      "consulenza-endermologie-60-min",
      "Consulenza endermologie®",
      60,
      5,
    ),
  ]),
  service("consulenza-laser", "laser", "Consulenza laser", [
    variant("consulenza-laser-30-min", "Consulenza laser", 30, 5),
  ]),
  service(
    "copertura-gel-delle-unghie-naturali",
    "manicure",
    "Copertura gel delle unghie naturali",
    [
      variant(
        "copertura-gel-delle-unghie-naturali-90-min",
        "Copertura gel delle unghie naturali",
        90,
        5,
      ),
    ],
  ),
  service(
    "corso-individuale-di-make-up-base",
    "makeup",
    "Corso individuale di make-up base",
    [
      variant(
        "corso-individuale-di-make-up-base-120-min",
        "Corso individuale di make-up base",
        120,
        5,
      ),
    ],
  ),
  service("detox", "lpg", "Detox", [variant("detox-40-min", "Detox", 40, 5)]),
  service("elite-active", "trattamenti-viso", "Elite active", [
    variant("elite-active-60-min", "Elite active", 60, 15),
  ]),
  service(
    "epilazione-con-filo-arabo-delle-sopracciglia",
    "ciglia-sopracciglia",
    "Epilazione con filo arabo delle sopracciglia",
    [
      variant(
        "epilazione-con-filo-arabo-delle-sopracciglia-15-min",
        "Epilazione con filo arabo delle sopracciglia",
        15,
        5,
      ),
    ],
  ),
  service("gamba-intera", "ceretta", "Gamba intera", [
    variant("gamba-intera-60-min", "Gamba intera", 60, 5),
  ]),
  service("gamba-intera-uomo", "ceretta", "Gamba intera uomo", [
    variant("gamba-intera-uomo-35-min", "Gamba intera uomo", 35, 15),
  ]),
  service("glutei", "ceretta", "Glutei", [
    variant("glutei-30-min", "Glutei", 30, 5),
  ]),
  service(
    "grow-up-sopracciglia",
    "ciglia-sopracciglia",
    "Grow up sopracciglia",
    [variant("grow-up-sopracciglia-30-min", "Grow up sopracciglia", 30, 5)],
  ),
];
