import { describe, expect, it } from "vitest";

import ritualiData from "@/data/ritualiData.js";
import {
  APPOINTMENT_TYPES,
  getAppointmentTypesArray,
} from "@/lib/utils/constants.js";
import {
  assertValidCatalog,
  CATALOG_EXPECTATIONS,
  getCatalogSummary,
  SERVICE_CATALOG,
  validateCatalog,
} from "@/lib/domain/catalog/index.ts";

const CATEGORY_ID_BY_LEGACY_ID = {
  body: "trattamenti-corpo",
  eyebrows_lashes: "ciglia-sopracciglia",
  facial: "trattamenti-viso",
  hair_removal: "ceretta",
  laser: "laser",
  lpg: "lpg",
  makeup: "makeup",
  manicure: "manicure",
  massage: "massaggi",
  pedicure: "pedicure",
  rituals: "rituali",
  spa: "bagno-turco",
};

const projectLegacyService = (legacyService) => ({
  categoryId: CATEGORY_ID_BY_LEGACY_ID[legacyService.category],
  nameIt: legacyService.type,
  active: legacyService.active,
  variants: legacyService.durations.map((duration, index) => ({
    nameIt: legacyService.variants[index],
    serviceDurationMinutes: duration,
    bufferMinutes: legacyService.extraTime[index],
    active: true,
  })),
});

const projectManifestService = (service) => ({
  categoryId: service.categoryId,
  nameIt: service.nameIt,
  active: service.active,
  variants: service.variants.map((variant) => ({
    nameIt: variant.nameIt,
    serviceDurationMinutes: variant.serviceDurationMinutes,
    bufferMinutes: variant.bufferMinutes,
    active: variant.active,
  })),
});

describe("stable service catalog", () => {
  it("is structurally valid and contains the reviewed row counts", () => {
    expect(validateCatalog(SERVICE_CATALOG)).toEqual([]);
    expect(() => assertValidCatalog(SERVICE_CATALOG)).not.toThrow();
    expect(getCatalogSummary(SERVICE_CATALOG)).toEqual(CATALOG_EXPECTATIONS);
  });

  it("preserves current UI service order and booking snapshots", () => {
    const legacyServices = getAppointmentTypesArray();

    expect(SERVICE_CATALOG.services.map(projectManifestService)).toEqual(
      legacyServices.map(projectLegacyService),
    );
  });

  it("preserves current public category optgroup order", () => {
    const legacyCategoryNames = [
      ...new Set(
        Object.values(APPOINTMENT_TYPES).map((service) => service.categoryName),
      ),
    ].sort((left, right) => left.localeCompare(right));

    expect(
      SERVICE_CATALOG.categories.map((category) => category.nameIt),
    ).toEqual(legacyCategoryNames);
  });

  it("deduplicates the exact repeated Rituale Kleopatra source entry", () => {
    const sourceCount = ritualiData.filter((service) =>
      service.bookingOptions?.some(
        (option) => option.type === "Rituale Kleopatra",
      ),
    ).length;
    const manifestCount = SERVICE_CATALOG.services.filter(
      (service) => service.nameIt === "Rituale Kleopatra",
    ).length;

    expect(sourceCount).toBe(2);
    expect(manifestCount).toBe(1);
  });

  it("uses collision-free kebab-case IDs and never invents a price", () => {
    const serviceIds = SERVICE_CATALOG.services.map((service) => service.id);
    const variants = SERVICE_CATALOG.services.flatMap(
      (service) => service.variants,
    );
    const variantIds = variants.map((variant) => variant.id);

    expect(new Set(serviceIds).size).toBe(serviceIds.length);
    expect(new Set(variantIds).size).toBe(variantIds.length);
    expect(
      serviceIds.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)),
    ).toBe(true);
    expect(
      variantIds.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)),
    ).toBe(true);
    expect(
      variants.every(
        (variant) => variant.priceCents === null && variant.currency === null,
      ),
    ).toBe(true);
  });

  it("reports ID collisions and incomplete prices without mutating input", () => {
    const firstService = SERVICE_CATALOG.services[0];
    const malformedVariant = {
      ...firstService.variants[0],
      priceCents: 5000,
      currency: null,
    };
    const malformedService = {
      ...firstService,
      id: "Bad ID",
      variants: [malformedVariant],
    };
    const invalidCatalog = {
      ...SERVICE_CATALOG,
      services: [...SERVICE_CATALOG.services, firstService, malformedService],
    };

    const issueCodes = validateCatalog(invalidCatalog).map(
      (issue) => issue.code,
    );

    expect(issueCodes).toContain("duplicate_service_id");
    expect(issueCodes).toContain("duplicate_variant_id");
    expect(issueCodes).toContain("invalid_id");
    expect(issueCodes).toContain("incomplete_price");
    expect(getCatalogSummary(SERVICE_CATALOG)).toEqual(CATALOG_EXPECTATIONS);
  });
});
