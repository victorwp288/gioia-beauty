import { describe, expect, it } from "vitest";

import {
  DomainChangeLogPersistenceSchema,
  PiiSafeOperationalLogSchema,
} from "@/lib/domain/schemas/index.ts";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTITY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("PII-minimized audit and log schemas", () => {
  it("accepts field names but no field values in the change log", () => {
    const event = {
      sequenceId: BigInt(1),
      aggregateKind: "schedule_entry",
      aggregateId: ENTITY_ID,
      aggregateVersion: 2,
      changeKind: "update",
      schemaVersion: 1,
      source: "admin",
      commandRequestId: REQUEST_ID,
      migrationRunId: null,
      actorUserId: ENTITY_ID,
      changedFields: ["client_email", "client_phone"],
      changedAt: "2026-07-09T10:00:00Z",
    };
    expect(DomainChangeLogPersistenceSchema.safeParse(event).success).toBe(
      true,
    );
    expect(
      DomainChangeLogPersistenceSchema.safeParse({
        ...event,
        changedFields: ["client_email=maria@example.com"],
      }).success,
    ).toBe(false);
  });

  it("rejects arbitrary messages and contact fields from operational logs", () => {
    const event = {
      eventCode: "BOOKING_CONFLICT",
      requestId: REQUEST_ID,
      resourceKind: "schedule_entry",
      resourceId: ENTITY_ID,
      errorCode: "SLOT_OCCUPIED",
    };
    expect(PiiSafeOperationalLogSchema.safeParse(event).success).toBe(true);
    for (const pii of [
      { email: "maria@example.com" },
      { phone: "+393331234567" },
      { message: "Booking failed for Maria Rossi" },
    ]) {
      expect(
        PiiSafeOperationalLogSchema.safeParse({ ...event, ...pii }).success,
      ).toBe(false);
    }
  });
});
