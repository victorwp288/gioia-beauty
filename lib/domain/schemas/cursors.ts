import { z } from "zod";

import {
  IsoInstantSchema,
  SalonDateSchema,
  StartMinutesSchema,
  UuidSchema,
} from "./primitives.ts";

export const CURSOR_TOKEN_LIFETIME_MILLISECONDS = 15 * 60 * 1_000;
export const MAXIMUM_CURSOR_TOKEN_WIRE_LENGTH = 512;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64URL_REMAINDER_TWO_FINAL_PATTERN = /^[AQgw]$/;
const BASE64URL_REMAINDER_THREE_FINAL_PATTERN = /^[AEIMQUYcgkosw048]$/;
const CURSOR_TOKEN_KEY_ID_PATTERN = /^[A-Za-z0-9_]{1,16}$/;
const POSTGRES_CURSOR_INSTANT_PATTERN =
  /^([1-9][0-9]{3}-[0-9]{2}-[0-9]{2})T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{6}Z$/;

export function isCursorTokenKeyId(value: unknown): value is string {
  return typeof value === "string" && CURSOR_TOKEN_KEY_ID_PATTERN.test(value);
}

function isCanonicalBase64url(value: string): boolean {
  if (!BASE64URL_PATTERN.test(value)) return false;
  const remainder = value.length % 4;
  if (remainder === 0) return true;
  if (remainder === 1) return false;
  const finalCharacter = value.at(-1) ?? "";
  return remainder === 2
    ? BASE64URL_REMAINDER_TWO_FINAL_PATTERN.test(finalCharacter)
    : BASE64URL_REMAINDER_THREE_FINAL_PATTERN.test(finalCharacter);
}

interface UnbrandedCursorTokenWireParts {
  readonly token: string;
  readonly header: string;
  readonly keyId: string;
  readonly encodedPayload: string;
  readonly encodedSignature: string;
}

function parseUnbrandedCursorTokenWire(
  value: unknown,
): UnbrandedCursorTokenWireParts | null {
  if (
    typeof value !== "string" ||
    value.length > MAXIMUM_CURSOR_TOKEN_WIRE_LENGTH
  ) {
    return null;
  }
  const segments = value.split(".");
  if (segments.length !== 3) return null;
  const [header, encodedPayload, encodedSignature] = segments;
  if (!header || !encodedPayload || !encodedSignature) return null;
  const keyId = header.startsWith("c1-") ? header.slice(3) : "";
  if (
    !isCursorTokenKeyId(keyId) ||
    !isCanonicalBase64url(encodedPayload) ||
    encodedSignature.length !== 43 ||
    !isCanonicalBase64url(encodedSignature)
  ) {
    return null;
  }
  return { token: value, header, keyId, encodedPayload, encodedSignature };
}

/** Structural framing only; this schema does not authenticate the cursor. */
export const PaginationCursorTokenWireSchema = z
  .string()
  .max(MAXIMUM_CURSOR_TOKEN_WIRE_LENGTH)
  .refine((value) => parseUnbrandedCursorTokenWire(value) !== null)
  .brand<"PaginationCursorTokenWire">();

export type PaginationCursorTokenWire = z.infer<
  typeof PaginationCursorTokenWireSchema
>;

export interface UnauthenticatedPaginationCursorTokenWire {
  readonly token: PaginationCursorTokenWire;
  readonly header: string;
  readonly keyId: string;
  readonly encodedPayload: string;
  readonly encodedSignature: string;
}

export function safeParsePaginationCursorTokenWire(
  value: unknown,
): Readonly<UnauthenticatedPaginationCursorTokenWire> | null {
  const token = PaginationCursorTokenWireSchema.safeParse(value);
  if (!token.success) return null;
  const parts = parseUnbrandedCursorTokenWire(token.data);
  return parts ? Object.freeze({ ...parts, token: token.data }) : null;
}

export const PaginationCursorScopeSchema = z.enum([
  "schedule.list",
  "schedule.export",
  "vacations.list",
  "subscribers.list",
  "outbox.list",
]);

export const CursorFilterFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

const SchedulePositionFields = {
  date: SalonDateSchema,
  startMinutes: StartMinutesSchema,
  id: UuidSchema,
};
const TimestampPositionFields = {
  createdAt: z
    .string()
    .regex(POSTGRES_CURSOR_INSTANT_PATTERN)
    .refine((value) => {
      const date = POSTGRES_CURSOR_INSTANT_PATTERN.exec(value)?.[1];
      return date !== undefined && SalonDateSchema.safeParse(date).success;
    }),
  id: UuidSchema,
};

const ScheduleCursorPositionSchema = z
  .object({ scope: z.literal("schedule.list"), ...SchedulePositionFields })
  .strict();
const ScheduleExportCursorPositionSchema = z
  .object({ scope: z.literal("schedule.export"), ...SchedulePositionFields })
  .strict();
const VacationCursorPositionSchema = z
  .object({
    scope: z.literal("vacations.list"),
    startDate: SalonDateSchema,
    id: UuidSchema,
  })
  .strict();
const SubscriberCursorPositionSchema = z
  .object({ scope: z.literal("subscribers.list"), ...TimestampPositionFields })
  .strict();
const OutboxCursorPositionSchema = z
  .object({ scope: z.literal("outbox.list"), ...TimestampPositionFields })
  .strict();

export const PaginationCursorPositionSchema = z.discriminatedUnion("scope", [
  ScheduleCursorPositionSchema,
  ScheduleExportCursorPositionSchema,
  VacationCursorPositionSchema,
  SubscriberCursorPositionSchema,
  OutboxCursorPositionSchema,
]);

const PayloadScopeFields = {
  version: z.literal(1),
  filterFingerprint: CursorFilterFingerprintSchema,
  issuedAt: IsoInstantSchema,
  expiresAt: IsoInstantSchema,
};

export const PaginationCursorPayloadSchema = z
  .discriminatedUnion("scope", [
    ScheduleCursorPositionSchema.extend({
      ...PayloadScopeFields,
      pageSize: z.number().int().min(1).max(100),
    }),
    ScheduleExportCursorPositionSchema.extend({
      ...PayloadScopeFields,
      pageSize: z.number().int().min(1).max(500),
    }),
    VacationCursorPositionSchema.extend({
      ...PayloadScopeFields,
      pageSize: z.number().int().min(1).max(100),
    }),
    SubscriberCursorPositionSchema.extend({
      ...PayloadScopeFields,
      pageSize: z.number().int().min(1).max(100),
    }),
    OutboxCursorPositionSchema.extend({
      ...PayloadScopeFields,
      pageSize: z.number().int().min(1).max(100),
    }),
  ])
  .superRefine((payload, context) => {
    if (
      Date.parse(payload.expiresAt) - Date.parse(payload.issuedAt) !==
      CURSOR_TOKEN_LIFETIME_MILLISECONDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cursor lifetime is invalid",
        path: ["expiresAt"],
      });
    }
  });

export type PaginationCursorScope = z.infer<typeof PaginationCursorScopeSchema>;
export type PaginationCursorPosition = z.infer<
  typeof PaginationCursorPositionSchema
>;
export type PaginationCursorPositionInput = z.input<
  typeof PaginationCursorPositionSchema
>;
export type PaginationCursorPayload = z.infer<
  typeof PaginationCursorPayloadSchema
>;
