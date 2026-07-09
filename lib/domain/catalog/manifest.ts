import { SERVICE_CATEGORIES } from "./categories.ts";
import { SERVICES_A_TO_G } from "./services/a-to-g.ts";
import { SERVICES_I_TO_M } from "./services/i-to-m.ts";
import { SERVICES_N_TO_R } from "./services/n-to-r.ts";
import { SERVICES_S_TO_Z } from "./services/s-to-z.ts";
import type { CatalogManifest, CatalogService } from "./types.ts";

// Concatenation order is canonical UI order and intentionally matches the
// legacy APPOINTMENT_TYPES dictionary order.
export const SERVICES: readonly CatalogService[] = [
  ...SERVICES_A_TO_G,
  ...SERVICES_I_TO_M,
  ...SERVICES_N_TO_R,
  ...SERVICES_S_TO_Z,
];

export { SERVICE_CATEGORIES };

export const CATALOG_EXPECTATIONS = {
  categories: 12,
  services: 74,
  variants: 102,
} as const;

export const SERVICE_CATALOG: CatalogManifest = {
  schemaVersion: 1,
  categories: SERVICE_CATEGORIES,
  services: SERVICES,
};
