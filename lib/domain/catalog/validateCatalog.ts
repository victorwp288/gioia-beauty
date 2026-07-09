import type {
  CatalogManifest,
  CatalogSummary,
  CatalogValidationIssue,
} from "./types.ts";

const KEBAB_CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isNonEmptyTrimmed = (value: string): boolean =>
  value.length > 0 && value === value.trim();

export const getCatalogSummary = (
  manifest: CatalogManifest,
): CatalogSummary => ({
  categories: manifest.categories.length,
  services: manifest.services.length,
  variants: manifest.services.reduce(
    (count, service) => count + service.variants.length,
    0,
  ),
});

export const validateCatalog = (
  manifest: CatalogManifest,
): readonly CatalogValidationIssue[] => {
  const issues: CatalogValidationIssue[] = [];
  const categoryIds = new Set<string>();
  const categorySortOrders = new Set<number>();
  const serviceIds = new Set<string>();
  const serviceNames = new Set<string>();
  const variantIds = new Set<string>();

  const addIssue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) {
    addIssue(
      "invalid_schema_version",
      "schemaVersion",
      "schemaVersion must be a positive integer",
    );
  }

  manifest.categories.forEach((category, categoryIndex) => {
    const path = `categories[${categoryIndex}]`;

    if (!KEBAB_CASE_ID.test(category.id)) {
      addIssue("invalid_id", `${path}.id`, "category id must be kebab-case");
    }
    if (categoryIds.has(category.id)) {
      addIssue("duplicate_category_id", `${path}.id`, category.id);
    }
    categoryIds.add(category.id);

    if (!isNonEmptyTrimmed(category.nameIt)) {
      addIssue(
        "invalid_italian_name",
        `${path}.nameIt`,
        "category name must be non-empty and trimmed",
      );
    }
    if (!Number.isInteger(category.sortOrder) || category.sortOrder < 0) {
      addIssue(
        "invalid_sort_order",
        `${path}.sortOrder`,
        "category sort order must be a non-negative integer",
      );
    }
    if (categorySortOrders.has(category.sortOrder)) {
      addIssue(
        "duplicate_category_sort_order",
        `${path}.sortOrder`,
        String(category.sortOrder),
      );
    }
    categorySortOrders.add(category.sortOrder);
  });

  const expectedSortOrders = manifest.categories.map((_, index) => index);
  const actualSortOrders = [...categorySortOrders].sort(
    (left, right) => left - right,
  );
  if (
    actualSortOrders.length !== expectedSortOrders.length ||
    actualSortOrders.some((value, index) => value !== expectedSortOrders[index])
  ) {
    addIssue(
      "non_contiguous_category_sort_order",
      "categories",
      "category sort orders must be contiguous from zero",
    );
  }

  manifest.services.forEach((service, serviceIndex) => {
    const path = `services[${serviceIndex}]`;

    if (!KEBAB_CASE_ID.test(service.id)) {
      addIssue("invalid_id", `${path}.id`, "service id must be kebab-case");
    }
    if (serviceIds.has(service.id)) {
      addIssue("duplicate_service_id", `${path}.id`, service.id);
    }
    serviceIds.add(service.id);

    if (!isNonEmptyTrimmed(service.nameIt)) {
      addIssue(
        "invalid_italian_name",
        `${path}.nameIt`,
        "service name must be non-empty and trimmed",
      );
    }
    if (serviceNames.has(service.nameIt)) {
      addIssue("duplicate_service_name", `${path}.nameIt`, service.nameIt);
    }
    serviceNames.add(service.nameIt);

    if (!categoryIds.has(service.categoryId)) {
      addIssue("unknown_category", `${path}.categoryId`, service.categoryId);
    }
    if (service.variants.length === 0) {
      addIssue(
        "missing_variants",
        `${path}.variants`,
        "service must contain at least one variant",
      );
    }

    service.variants.forEach((variant, variantIndex) => {
      const variantPath = `${path}.variants[${variantIndex}]`;

      if (!KEBAB_CASE_ID.test(variant.id)) {
        addIssue(
          "invalid_id",
          `${variantPath}.id`,
          "variant id must be kebab-case",
        );
      }
      if (!variant.id.startsWith(`${service.id}-`)) {
        addIssue(
          "variant_id_service_mismatch",
          `${variantPath}.id`,
          variant.id,
        );
      }
      if (variantIds.has(variant.id)) {
        addIssue("duplicate_variant_id", `${variantPath}.id`, variant.id);
      }
      variantIds.add(variant.id);

      if (!isNonEmptyTrimmed(variant.nameIt)) {
        addIssue(
          "invalid_italian_name",
          `${variantPath}.nameIt`,
          "variant name must be non-empty and trimmed",
        );
      }
      if (
        !Number.isInteger(variant.serviceDurationMinutes) ||
        variant.serviceDurationMinutes <= 0 ||
        variant.serviceDurationMinutes > 480
      ) {
        addIssue(
          "invalid_service_duration",
          `${variantPath}.serviceDurationMinutes`,
          String(variant.serviceDurationMinutes),
        );
      }
      if (
        !Number.isInteger(variant.bufferMinutes) ||
        variant.bufferMinutes < 0 ||
        variant.bufferMinutes > 120
      ) {
        addIssue(
          "invalid_buffer",
          `${variantPath}.bufferMinutes`,
          String(variant.bufferMinutes),
        );
      }

      const hasPrice = variant.priceCents !== null;
      const hasCurrency = variant.currency !== null;
      if (hasPrice !== hasCurrency) {
        addIssue(
          "incomplete_price",
          variantPath,
          "price and currency must either both be null or both be set",
        );
      }
      if (
        hasPrice &&
        (!Number.isInteger(variant.priceCents) || variant.priceCents < 0)
      ) {
        addIssue(
          "invalid_price",
          `${variantPath}.priceCents`,
          String(variant.priceCents),
        );
      }
      if (hasCurrency && variant.currency !== "EUR") {
        addIssue(
          "invalid_currency",
          `${variantPath}.currency`,
          String(variant.currency),
        );
      }
    });
  });

  return issues;
};

export const assertValidCatalog = (manifest: CatalogManifest): void => {
  const issues = validateCatalog(manifest);
  if (issues.length === 0) return;

  const details = issues
    .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid service catalog:\n${details}`);
};
