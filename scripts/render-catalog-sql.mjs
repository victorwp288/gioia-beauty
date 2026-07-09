import { renderCatalogSql } from "../lib/domain/catalog/renderSql.ts";

const section = process.argv[2];

if (!new Set(["categories", "services", "variants"]).has(section)) {
  throw new Error("Usage: render-catalog-sql.mjs categories|services|variants");
}

process.stdout.write(renderCatalogSql(section));
