import type {
  CatalogCategoryId,
  CatalogService,
  CatalogVariant,
} from "./types.ts";

export const variant = (
  id: string,
  nameIt: string,
  serviceDurationMinutes: number,
  bufferMinutes: number,
): CatalogVariant => ({
  id,
  nameIt,
  serviceDurationMinutes,
  bufferMinutes,
  priceCents: null,
  currency: null,
  active: true,
});

export const service = (
  id: string,
  categoryId: CatalogCategoryId,
  nameIt: string,
  variants: readonly CatalogVariant[],
): CatalogService => ({
  id,
  categoryId,
  nameIt,
  active: true,
  variants,
});
