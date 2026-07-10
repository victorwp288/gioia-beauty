import { describe, expect, it } from "vitest";

import {
  CatalogCategorySchema,
  CatalogServiceIdSchema,
  CatalogVariantSchema,
  IdempotencyKeySchema,
  NormalizedEmailSchema,
  NormalizedPhoneSchema,
  PublicNoteSchema,
  RequestFingerprintSchema,
  SalonDateSchema,
  StartMinutesSchema,
} from "@/lib/domain/schemas/index.ts";

describe("boundary primitives", () => {
  it("normalizes email, phone, notes, UUIDs, and SHA-256 fingerprints", () => {
    expect(NormalizedEmailSchema.parse("  CLIENT@Example.COM ")).toBe(
      "client@example.com",
    );
    expect(NormalizedPhoneSchema.parse("0039 (333) 123-4567")).toBe(
      "+393331234567",
    );
    expect(PublicNoteSchema.parse("  Solo mattina  ")).toBe("Solo mattina");
    expect(PublicNoteSchema.parse("   ")).toBeNull();
    expect(
      IdempotencyKeySchema.parse("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
    ).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(RequestFingerprintSchema.parse("A".repeat(64))).toBe("a".repeat(64));
  });

  it("rejects malformed contact and identity values", () => {
    for (const email of ["", "not-an-email", `x@${"a".repeat(316)}.it`]) {
      expect(NormalizedEmailSchema.safeParse(email).success).toBe(false);
    }
    for (const phone of ["123", "+012345678", "333/123/4567", "not-phone"]) {
      expect(NormalizedPhoneSchema.safeParse(phone).success).toBe(false);
    }
    expect(IdempotencyKeySchema.safeParse("not-a-uuid").success).toBe(false);
    expect(RequestFingerprintSchema.safeParse("a".repeat(63)).success).toBe(
      false,
    );
  });

  it("accepts only real salon dates and valid start minutes", () => {
    expect(SalonDateSchema.parse("2024-02-29")).toBe("2024-02-29");
    for (const date of [
      "0000-01-01",
      "2025-02-29",
      "2026-7-09",
      "2026-07-09T00:00:00Z",
    ]) {
      expect(SalonDateSchema.safeParse(date).success).toBe(false);
    }
    for (const minute of [-1, 1.5, 1440, Number.NaN]) {
      expect(StartMinutesSchema.safeParse(minute).success).toBe(false);
    }
  });
});

describe("catalog schemas", () => {
  it("accepts stable IDs and strict known categories", () => {
    expect(CatalogServiceIdSchema.parse("massaggio-relax")).toBe(
      "massaggio-relax",
    );
    expect(CatalogServiceIdSchema.safeParse("Massaggio Relax").success).toBe(
      false,
    );
    expect(
      CatalogCategorySchema.parse({
        id: "massaggi",
        nameIt: " Massaggi ",
        sortOrder: 7,
        active: true,
      }),
    ).toEqual({
      id: "massaggi",
      nameIt: "Massaggi",
      sortOrder: 7,
      active: true,
    });
    expect(
      CatalogCategorySchema.safeParse({
        id: "unknown",
        nameIt: "Unknown",
        sortOrder: 1,
        active: true,
      }).success,
    ).toBe(false);
  });

  it("requires price and currency to be paired and rejects unknown keys", () => {
    const variant = {
      id: "relax-60",
      serviceId: "massaggio-relax",
      nameIt: "60 minuti",
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: null,
      currency: null,
      sortOrder: 0,
      active: true,
    };
    expect(CatalogVariantSchema.parse(variant)).toEqual(variant);
    expect(
      CatalogVariantSchema.safeParse({
        ...variant,
        priceCents: 5000,
        currency: null,
      }).success,
    ).toBe(false);
    expect(
      CatalogVariantSchema.safeParse({ ...variant, legacyName: "Relax" })
        .success,
    ).toBe(false);
  });
});
