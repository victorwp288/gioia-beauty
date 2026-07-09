import { z } from "zod";

import {
  IsoInstantSchema,
  RequestFingerprintSchema,
  SalonDateSchema,
  StartMinutesSchema,
  UuidSchema,
} from "./primitives.ts";

export const SignedCursorTokenSchema = z
  .string()
  .trim()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

const cursorScopeFields = {
  version: z.literal(1),
  filterFingerprint: RequestFingerprintSchema,
  expiresAt: IsoInstantSchema,
};

const ScheduleCursorPayloadSchema = z
  .object({
    ...cursorScopeFields,
    resource: z.literal("schedule"),
    date: SalonDateSchema,
    startMinutes: StartMinutesSchema,
    id: UuidSchema,
  })
  .strict();

const VacationCursorPayloadSchema = z
  .object({
    ...cursorScopeFields,
    resource: z.literal("vacations"),
    startDate: SalonDateSchema,
    id: UuidSchema,
  })
  .strict();

const TimestampCursorFields = {
  ...cursorScopeFields,
  createdAt: IsoInstantSchema,
  id: UuidSchema,
};

const SubscriberCursorPayloadSchema = z
  .object({ ...TimestampCursorFields, resource: z.literal("subscribers") })
  .strict();
const OutboxCursorPayloadSchema = z
  .object({ ...TimestampCursorFields, resource: z.literal("outbox") })
  .strict();

export const VerifiedCursorPayloadSchema = z.discriminatedUnion("resource", [
  ScheduleCursorPayloadSchema,
  VacationCursorPayloadSchema,
  SubscriberCursorPayloadSchema,
  OutboxCursorPayloadSchema,
]);

type CursorResource = z.infer<typeof VerifiedCursorPayloadSchema>["resource"];

function cursorScopeError(path: string, message: string) {
  return new z.ZodError([
    {
      code: z.ZodIssueCode.custom,
      path: [path],
      message,
    },
  ]);
}

export function parseVerifiedCursorPayload(
  verifiedPayload: unknown,
  expected: {
    resource: CursorResource;
    filterFingerprint: string;
    now: Date;
  },
) {
  const payload = VerifiedCursorPayloadSchema.parse(verifiedPayload);
  if (payload.resource !== expected.resource) {
    throw cursorScopeError("resource", "Cursor belongs to another resource");
  }
  if (payload.filterFingerprint !== expected.filterFingerprint.toLowerCase()) {
    throw cursorScopeError(
      "filterFingerprint",
      "Cursor does not match the active filters",
    );
  }
  if (new Date(payload.expiresAt).getTime() <= expected.now.getTime()) {
    throw cursorScopeError("expiresAt", "Cursor has expired");
  }
  return payload;
}

export type SignedCursorToken = z.infer<typeof SignedCursorTokenSchema>;
export type VerifiedCursorPayload = z.infer<typeof VerifiedCursorPayloadSchema>;
