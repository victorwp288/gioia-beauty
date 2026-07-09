export type CatalogCategoryId =
  | "bagno-turco"
  | "ceretta"
  | "ciglia-sopracciglia"
  | "laser"
  | "lpg"
  | "makeup"
  | "manicure"
  | "massaggi"
  | "pedicure"
  | "rituali"
  | "trattamenti-corpo"
  | "trattamenti-viso";

export type CatalogCurrency = "EUR";

export interface CatalogCategory {
  readonly id: CatalogCategoryId;
  readonly nameIt: string;
  readonly sortOrder: number;
  readonly active: boolean;
}

export interface CatalogVariant {
  readonly id: string;
  readonly nameIt: string;
  readonly serviceDurationMinutes: number;
  readonly bufferMinutes: number;
  readonly priceCents: number | null;
  readonly currency: CatalogCurrency | null;
  readonly active: boolean;
}

export interface CatalogService {
  readonly id: string;
  readonly categoryId: CatalogCategoryId;
  readonly nameIt: string;
  readonly active: boolean;
  readonly variants: readonly CatalogVariant[];
}

export interface CatalogManifest {
  readonly schemaVersion: number;
  readonly categories: readonly CatalogCategory[];
  readonly services: readonly CatalogService[];
}

export interface CatalogSummary {
  readonly categories: number;
  readonly services: number;
  readonly variants: number;
}

export interface CatalogValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}
