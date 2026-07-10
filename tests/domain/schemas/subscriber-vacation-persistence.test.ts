import { describe, expect, it } from "vitest";

import {
  AdminSubscriberDtoSchema,
  PublicSubscribeCommandSchema,
  PublicUnsubscribeCommandSchema,
  SubscriberPersistenceSchema,
  VacationPersistenceSchema,
} from "@/lib/domain/schemas/index.ts";

const IDEMPOTENCY_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTITY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CREATED_AT = "2026-07-09T10:00:00Z";

const ACTIVE_SUBSCRIBER = {
  id: ENTITY_ID,
  schemaVersion: 1,
  email: "owner@example.com",
  status: "active" as const,
  source: "public" as const,
  consentAt: CREATED_AT,
  consentSource: "footer",
  consentPolicyVersion: "2026-07",
  confirmedAt: "2026-07-09T10:05:00Z",
  unsubscribedAt: null,
  legacyFirestoreId: null,
  timestampProvenance: "source" as const,
  importedAt: null,
  version: 1,
  createdAt: CREATED_AT,
  updatedAt: "2026-07-09T10:05:00Z",
};

describe("subscriber boundaries", () => {
  it("accepts consent acknowledgement but rejects client provenance", () => {
    const input = {
      idempotencyKey: IDEMPOTENCY_KEY,
      email: " OWNER@Example.COM ",
      consent: true,
    } as const;
    expect(PublicSubscribeCommandSchema.parse(input)).toEqual({
      ...input,
      email: "owner@example.com",
    });
    for (const forbidden of [
      "consentSource",
      "consentPolicyVersion",
      "status",
    ]) {
      expect(
        PublicSubscribeCommandSchema.safeParse({
          ...input,
          [forbidden]: "caller-controlled",
        }).success,
      ).toBe(false);
    }
    expect(
      PublicSubscribeCommandSchema.safeParse({ ...input, consent: false })
        .success,
    ).toBe(false);
  });

  it("requires an exact unsubscribe token wire rather than an email", () => {
    const token = `n1-test.AAAA.${"A".repeat(43)}`;
    expect(PublicUnsubscribeCommandSchema.safeParse({ token }).success).toBe(
      true,
    );
    expect(
      PublicUnsubscribeCommandSchema.safeParse({ email: "owner@example.com" })
        .success,
    ).toBe(false);
  });

  it("enforces SQL consent and state invariants", () => {
    expect(
      SubscriberPersistenceSchema.safeParse(ACTIVE_SUBSCRIBER).success,
    ).toBe(true);
    for (const status of ["bounced", "complained"] as const) {
      expect(
        SubscriberPersistenceSchema.safeParse({
          ...ACTIVE_SUBSCRIBER,
          status,
          consentAt: null,
          consentSource: null,
          consentPolicyVersion: null,
          confirmedAt: null,
        }).success,
      ).toBe(false);
    }
    expect(
      SubscriberPersistenceSchema.safeParse({
        ...ACTIVE_SUBSCRIBER,
        consentSource: null,
      }).success,
    ).toBe(false);
    expect(
      SubscriberPersistenceSchema.safeParse({
        ...ACTIVE_SUBSCRIBER,
        confirmedAt: "2026-07-09T09:59:00Z",
      }).success,
    ).toBe(false);
  });

  it("requires migration provenance for legacy-unverified records", () => {
    const legacy = {
      ...ACTIVE_SUBSCRIBER,
      status: "legacy_unverified" as const,
      source: "migration" as const,
      consentAt: null,
      consentSource: null,
      consentPolicyVersion: null,
      confirmedAt: null,
      legacyFirestoreId: "legacy-subscriber-1",
      importedAt: "2026-07-09T11:00:00Z",
    };
    expect(SubscriberPersistenceSchema.safeParse(legacy).success).toBe(true);
    expect(
      SubscriberPersistenceSchema.safeParse({
        ...legacy,
        source: "public",
        legacyFirestoreId: null,
        importedAt: null,
      }).success,
    ).toBe(false);
  });

  it("separates admin DTOs from persistence provenance", () => {
    const dto = {
      id: ACTIVE_SUBSCRIBER.id,
      schemaVersion: 1,
      email: ACTIVE_SUBSCRIBER.email,
      status: ACTIVE_SUBSCRIBER.status,
      source: ACTIVE_SUBSCRIBER.source,
      consentAt: ACTIVE_SUBSCRIBER.consentAt,
      consentSource: ACTIVE_SUBSCRIBER.consentSource,
      consentPolicyVersion: ACTIVE_SUBSCRIBER.consentPolicyVersion,
      confirmedAt: ACTIVE_SUBSCRIBER.confirmedAt,
      unsubscribedAt: ACTIVE_SUBSCRIBER.unsubscribedAt,
      version: 1,
      createdAt: CREATED_AT,
      updatedAt: ACTIVE_SUBSCRIBER.updatedAt,
    };
    expect(AdminSubscriberDtoSchema.safeParse(dto).success).toBe(true);
    expect(AdminSubscriberDtoSchema.safeParse(ACTIVE_SUBSCRIBER).success).toBe(
      false,
    );
  });
});

describe("vacation persistence", () => {
  it("requires the cancelling owner for admin vacations", () => {
    const vacation = {
      id: ENTITY_ID,
      schemaVersion: 1,
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      status: "cancelled" as const,
      reason: null,
      source: "admin" as const,
      createdBy: OWNER_ID,
      cancelledAt: "2026-07-10T10:00:00Z",
      cancelledBy: OWNER_ID,
      legacyFirestoreId: null,
      timestampProvenance: "source" as const,
      importedAt: null,
      version: 2,
      createdAt: CREATED_AT,
      updatedAt: "2026-07-10T10:00:00Z",
    };
    expect(VacationPersistenceSchema.safeParse(vacation).success).toBe(true);
    expect(
      VacationPersistenceSchema.safeParse({
        ...vacation,
        cancelledBy: null,
      }).success,
    ).toBe(false);
    expect(
      VacationPersistenceSchema.safeParse({
        ...vacation,
        updatedAt: "2026-07-09T09:00:00Z",
      }).success,
    ).toBe(false);
  });
});
