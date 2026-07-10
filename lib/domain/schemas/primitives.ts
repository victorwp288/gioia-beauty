import { z } from "zod";

import { asSalonDate } from "../booking/primitives.ts";

const CATALOG_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PHONE_PATTERN = /^(?:\+[1-9]\d{6,14}|\d{7,15})$/;
const SIGNED_TOKEN_PATTERN =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/;

function isSalonDate(value: string): boolean {
  try {
    asSalonDate(value);
    return true;
  } catch {
    return false;
  }
}

function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, "");
  return compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function nullableText(maximumLength: number) {
  return z.union([
    z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(maximumLength)),
    z.null(),
  ]);
}

export const UuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

export const CatalogIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(CATALOG_ID_PATTERN);

export const CatalogServiceIdSchema =
  CatalogIdSchema.brand<"CatalogServiceId">();
export const CatalogVariantIdSchema =
  CatalogIdSchema.brand<"CatalogVariantId">();

export const SalonDateSchema = z
  .string()
  .refine(isSalonDate, "Date must be a real calendar date in YYYY-MM-DD format")
  .transform((value) => asSalonDate(value));

export const StartMinutesSchema = z.number().int().min(0).max(1439);
export const DurationMinutesSchema = z.number().int().min(1).max(480);
export const BufferMinutesSchema = z.number().int().min(0).max(120);
export const PostgresIntegerSchema = z
  .number()
  .int()
  .min(-2_147_483_648)
  .max(2_147_483_647);
export const PositiveVersionSchema = PostgresIntegerSchema.min(1);
export const NonnegativePostgresIntegerSchema = PostgresIntegerSchema.min(0);
export const NonnegativePostgresSmallintSchema = z
  .number()
  .int()
  .min(0)
  .max(32_767);

export const NormalizedEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(320);

export const NormalizedPhoneSchema = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(PHONE_PATTERN).max(16));

export const PersonNameSchema = z.string().trim().min(1).max(160);

export function nullableTrimmedText(maximumLength: number) {
  return nullableText(maximumLength)
    .optional()
    .transform(normalizeNullableText);
}

export function optionalNullableTrimmedText(maximumLength: number) {
  return nullableText(maximumLength)
    .optional()
    .transform((value) =>
      value === undefined ? undefined : normalizeNullableText(value),
    );
}

export const PublicNoteSchema = nullableTrimmedText(2000);
export const InternalNoteSchema = nullableTrimmedText(2000);
export const CancellationReasonSchema = nullableTrimmedText(1000);
export const VacationReasonSchema = nullableTrimmedText(1000);

export const IdempotencyKeySchema = UuidSchema.brand<"IdempotencyKey">();
export const SignedActionTokenSchema = z
  .string()
  .trim()
  .min(32)
  .max(2048)
  .regex(SIGNED_TOKEN_PATTERN);

export const RequestFingerprintSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HEX_SHA256_PATTERN)
  .brand<"RequestFingerprint">();

export const Sha256Schema = RequestFingerprintSchema;
export const ErrorCodeSchema = z.string().regex(ERROR_CODE_PATTERN);
export const IsoInstantSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

export type CatalogServiceId = z.infer<typeof CatalogServiceIdSchema>;
export type CatalogVariantId = z.infer<typeof CatalogVariantIdSchema>;
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
export type NormalizedEmail = z.infer<typeof NormalizedEmailSchema>;
export type NormalizedPhone = z.infer<typeof NormalizedPhoneSchema>;
export type RequestFingerprint = z.infer<typeof RequestFingerprintSchema>;
