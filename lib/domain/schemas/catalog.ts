import { z } from "zod";

import { SERVICE_CATEGORIES } from "../catalog/categories.ts";
import {
  BufferMinutesSchema,
  CatalogServiceIdSchema,
  CatalogVariantIdSchema,
  DurationMinutesSchema,
  NonnegativePostgresIntegerSchema,
  NonnegativePostgresSmallintSchema,
} from "./primitives.ts";

const categoryIds = SERVICE_CATEGORIES.map((category) => category.id) as [
  (typeof SERVICE_CATEGORIES)[number]["id"],
  ...(typeof SERVICE_CATEGORIES)[number]["id"][],
];

export const CatalogCategoryIdSchema = z.enum(categoryIds);
export const CatalogCurrencySchema = z.literal("EUR");

export const CatalogCategorySchema = z
  .object({
    id: CatalogCategoryIdSchema,
    nameIt: z.string().trim().min(1).max(100),
    sortOrder: NonnegativePostgresSmallintSchema,
    active: z.boolean(),
  })
  .strict();

export const CatalogServiceSchema = z
  .object({
    id: CatalogServiceIdSchema,
    categoryId: CatalogCategoryIdSchema,
    nameIt: z.string().trim().min(1).max(160),
    descriptionIt: z.string().trim().max(2000).nullable(),
    sortOrder: NonnegativePostgresSmallintSchema,
    active: z.boolean(),
  })
  .strict();

export const CatalogVariantSchema = z
  .object({
    id: CatalogVariantIdSchema,
    serviceId: CatalogServiceIdSchema,
    nameIt: z.string().trim().min(1).max(160),
    durationMinutes: DurationMinutesSchema,
    bufferMinutes: BufferMinutesSchema,
    priceCents: NonnegativePostgresIntegerSchema.nullable(),
    currency: CatalogCurrencySchema.nullable(),
    sortOrder: NonnegativePostgresSmallintSchema,
    active: z.boolean(),
  })
  .strict()
  .superRefine((variant, context) => {
    if ((variant.priceCents === null) !== (variant.currency === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Price and currency must both be present or both be null",
        path: [variant.priceCents === null ? "priceCents" : "currency"],
      });
    }
  });

export type CatalogCategoryInput = z.infer<typeof CatalogCategorySchema>;
export type CatalogServiceInput = z.infer<typeof CatalogServiceSchema>;
export type CatalogVariantInput = z.infer<typeof CatalogVariantSchema>;
