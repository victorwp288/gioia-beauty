import { SERVICE_CATALOG } from "@/lib/domain/catalog/index.ts";
import type {
  CatalogService,
  CatalogVariant,
} from "@/lib/domain/catalog/types.ts";
import {
  RecordQuarantine,
  type TransformContext,
} from "./legacyFirestoreTransformTypes.ts";
import { normalizeLookup } from "./legacyFirestoreTransformHelpers.ts";

export function resolveCatalog(
  appointmentType: string | undefined,
  legacyVariant: string | number | undefined,
  context: TransformContext,
): { service: CatalogService; variant: CatalogVariant } {
  const typeKey = normalizeLookup(appointmentType ?? "");
  const variantKey = normalizeLookup(
    legacyVariant === undefined ? "" : String(legacyVariant),
  );
  const explicit = context.catalogMappings.filter(
    (mapping) =>
      normalizeLookup(mapping.legacyAppointmentType) === typeKey &&
      normalizeLookup(mapping.legacyVariant ?? "") === variantKey,
  );
  if (explicit.length > 1) {
    throw new RecordQuarantine("AMBIGUOUS_CATALOG_MAPPING", [
      "APPOINTMENT_TYPE",
      "VARIANT",
    ]);
  }
  if (explicit.length === 1) {
    const mapping = explicit[0];
    const service = SERVICE_CATALOG.services.find(
      (candidate) => candidate.id === mapping?.serviceId,
    );
    const variant = service?.variants.find(
      (candidate) => candidate.id === mapping?.variantId,
    );
    if (!service || !variant) {
      throw new RecordQuarantine("UNMAPPED_CATALOG", ["CATALOG_MAPPING"]);
    }
    return { service, variant };
  }

  const services = SERVICE_CATALOG.services.filter(
    (candidate) => normalizeLookup(candidate.nameIt) === typeKey,
  );
  if (services.length !== 1) {
    throw new RecordQuarantine(
      services.length === 0 ? "UNMAPPED_CATALOG" : "AMBIGUOUS_CATALOG_MAPPING",
      ["APPOINTMENT_TYPE"],
    );
  }
  const service = services[0]!;
  let variants: readonly CatalogVariant[] = [];
  if (variantKey.length === 0 && service.variants.length === 1) {
    variants = service.variants;
  } else if (/^\d+$/.test(variantKey)) {
    variants = service.variants.filter(
      (candidate) => candidate.serviceDurationMinutes === Number(variantKey),
    );
  } else {
    variants = service.variants.filter(
      (candidate) =>
        normalizeLookup(candidate.id) === variantKey ||
        normalizeLookup(candidate.nameIt) === variantKey,
    );
  }
  if (variants.length !== 1) {
    throw new RecordQuarantine(
      variants.length === 0 ? "UNMAPPED_CATALOG" : "AMBIGUOUS_CATALOG_MAPPING",
      ["VARIANT"],
    );
  }
  return { service, variant: variants[0]! };
}
