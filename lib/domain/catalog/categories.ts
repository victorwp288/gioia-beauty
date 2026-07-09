import type { CatalogCategory } from "./types.ts";

// This order reproduces the public booking category optgroups.
export const SERVICE_CATEGORIES: readonly CatalogCategory[] = [
  { id: "bagno-turco", nameIt: "Bagno Turco", sortOrder: 0, active: true },
  { id: "ceretta", nameIt: "Ceretta", sortOrder: 1, active: true },
  {
    id: "ciglia-sopracciglia",
    nameIt: "Ciglia e Sopracciglia",
    sortOrder: 2,
    active: true,
  },
  { id: "laser", nameIt: "Laser", sortOrder: 3, active: true },
  { id: "lpg", nameIt: "Lpg Endermologie", sortOrder: 4, active: true },
  { id: "makeup", nameIt: "Makeup", sortOrder: 5, active: true },
  { id: "manicure", nameIt: "Manicure", sortOrder: 6, active: true },
  { id: "massaggi", nameIt: "Massaggi", sortOrder: 7, active: true },
  { id: "pedicure", nameIt: "Pedicure", sortOrder: 8, active: true },
  { id: "rituali", nameIt: "Rituali", sortOrder: 9, active: true },
  {
    id: "trattamenti-corpo",
    nameIt: "Trattamenti Corpo",
    sortOrder: 10,
    active: true,
  },
  {
    id: "trattamenti-viso",
    nameIt: "Trattamenti Viso",
    sortOrder: 11,
    active: true,
  },
];
