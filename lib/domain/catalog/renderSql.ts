import { createHash } from "node:crypto";

import { SERVICE_CATALOG } from "./manifest.ts";

export type CatalogSqlSection = "categories" | "services" | "variants";

const sqlLiteral = (value: string | null): string =>
  value === null ? "null" : `'${value.replaceAll("'", "''")}'`;

const manifestSha256 = (): string =>
  createHash("sha256").update(JSON.stringify(SERVICE_CATALOG)).digest("hex");

const statement = (
  table: string,
  columns: readonly string[],
  rows: readonly string[],
  expectedCount: number,
): string => `-- Generated from lib/domain/catalog/manifest.ts.
-- Manifest SHA-256: ${manifestSha256()}
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into gioia_private.${table} (
  ${columns.join(",\n  ")}
)
values
${rows.map((row, index) => `  ${row}${index === rows.length - 1 ? ";" : ","}`).join("\n")}

do $catalog_count$
begin
  if (select count(*) from gioia_private.${table}) <> ${expectedCount} then
    raise exception 'Unexpected ${table} row count';
  end if;
end
$catalog_count$;

commit;
`;

const renderCategories = (): string =>
  statement(
    "service_categories",
    ["id", "display_name_it", "sort_order", "active"],
    SERVICE_CATALOG.categories.map(
      (category) =>
        `(${sqlLiteral(category.id)}, ${sqlLiteral(category.nameIt)}, ${category.sortOrder}, ${category.active})`,
    ),
    SERVICE_CATALOG.categories.length,
  );

const renderServices = (): string => {
  const categoryOrders = new Map<string, number>();
  const rows = SERVICE_CATALOG.services.map((service) => {
    const sortOrder = categoryOrders.get(service.categoryId) ?? 0;
    categoryOrders.set(service.categoryId, sortOrder + 1);

    return `(${sqlLiteral(service.id)}, ${sqlLiteral(service.categoryId)}, ${sqlLiteral(service.nameIt)}, ${sortOrder}, ${service.active})`;
  });

  return statement(
    "services",
    ["id", "category_id", "display_name_it", "sort_order", "active"],
    rows,
    SERVICE_CATALOG.services.length,
  );
};

const renderVariants = (): string => {
  const rows = SERVICE_CATALOG.services.flatMap((service) =>
    service.variants.map(
      (variant, sortOrder) =>
        `(${sqlLiteral(variant.id)}, ${sqlLiteral(service.id)}, ${sqlLiteral(variant.nameIt)}, ${sortOrder}, ${variant.serviceDurationMinutes}, ${variant.bufferMinutes}, ${variant.priceCents ?? "null"}, ${sqlLiteral(variant.currency)}, ${variant.active})`,
    ),
  );

  return statement(
    "service_variants",
    [
      "id",
      "service_id",
      "display_name_it",
      "sort_order",
      "duration_minutes",
      "buffer_minutes",
      "price_cents",
      "currency",
      "active",
    ],
    rows,
    rows.length,
  );
};

export const renderCatalogSql = (section: CatalogSqlSection): string => {
  if (section === "categories") return renderCategories();
  if (section === "services") return renderServices();
  return renderVariants();
};
