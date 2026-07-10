import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  renderCatalogSql,
  type CatalogSqlSection,
} from "@/lib/domain/catalog/renderSql.ts";

const MIGRATIONS: Readonly<Record<CatalogSqlSection, string>> = {
  categories:
    "supabase/migrations/20260709235606_load_authoritative_catalog_categories.sql",
  services:
    "supabase/migrations/20260709235614_load_authoritative_catalog_services.sql",
  variants:
    "supabase/migrations/20260709235620_load_authoritative_catalog_variants.sql",
};

describe("catalog SQL migrations", () => {
  for (const [section, relativePath] of Object.entries(MIGRATIONS) as Array<
    [CatalogSqlSection, string]
  >) {
    it(`${section} migration matches the authoritative manifest`, () => {
      const committedSql = readFileSync(resolve(relativePath), "utf8");

      expect(committedSql).toBe(renderCatalogSql(section));
    });
  }
});
