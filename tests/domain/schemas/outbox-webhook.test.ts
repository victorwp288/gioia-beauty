import { describe, expect, it } from "vitest";

import {
  EmailOutboxPersistenceSchema,
  EmailWebhookEventPersistenceSchema,
  OutboxClaimInputSchema,
  OutboxClaimRequestSchema,
  OutboxLogEventSchema,
  OutboxWorkerReportSchema,
  VerifiedEmailWebhookEventSchema,
  WebhookSignatureHeadersSchema,
  assertWebhookTimestampFresh,
} from "@/lib/domain/schemas/index.ts";

const OUTBOX_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGGREGATE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CREATED_AT = "2026-07-09T10:00:00Z";
const CLAIM_TOKEN = `${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;

const OUTBOX = {
  id: OUTBOX_ID,
  aggregateKind: "schedule_entry" as const,
  aggregateId: AGGREGATE_ID,
  aggregateVersion: 1,
  recipientKind: "customer" as const,
  recipientAddress: "maria@example.com",
  templateKind: "booking_customer" as const,
  templateData: {
    clientName: "Maria Rossi",
    localDate: "2026-08-10",
    startMinutes: 600,
    serviceDurationMinutes: 60,
    serviceName: "Massaggio relax",
    variantName: "60 minuti",
  },
  idempotencyKey: "booking:customer:1",
  status: "pending" as const,
  providerMessageId: null,
  attemptCount: 0,
  nextAttemptAt: CREATED_AT,
  lockedAt: null,
  lockedBy: null,
  leaseExpiresAt: null,
  lastErrorCode: null,
  sentAt: null,
  version: 1,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

describe("outbox persistence and worker contracts", () => {
  it("accepts only the SQL-allowlisted immutable template snapshot", () => {
    expect(EmailOutboxPersistenceSchema.safeParse(OUTBOX).success).toBe(true);
    for (const [field, value] of Object.entries({
      clientNote: "Sensitive note",
      clientPhone: "+393331234567",
      token: "secret",
    })) {
      expect(
        EmailOutboxPersistenceSchema.safeParse({
          ...OUTBOX,
          templateData: { ...OUTBOX.templateData, [field]: value },
        }).success,
      ).toBe(false);
    }
    expect(
      EmailOutboxPersistenceSchema.safeParse({
        ...OUTBOX,
        templateKind: "reschedule_customer",
      }).success,
    ).toBe(false);
  });

  it("keeps worker identity server-derived", () => {
    expect(OutboxClaimRequestSchema.parse({})).toEqual({
      batchSize: 25,
      leaseSeconds: 120,
    });
    expect(
      OutboxClaimRequestSchema.safeParse({ workerId: "caller-chosen" }).success,
    ).toBe(false);
    expect(
      OutboxClaimInputSchema.safeParse({ workerId: "cron:iad1:42" }).success,
    ).toBe(true);
  });

  it("requires lease-safe completion identities and unique rows", () => {
    const result = {
      outboxId: OUTBOX_ID,
      expectedVersion: 2,
      attemptCount: 1,
      claimToken: CLAIM_TOKEN,
      result: "failed" as const,
      errorCode: "PROVIDER_TIMEOUT",
      retryable: true,
    };
    const report = { workerId: "cron:iad1:42", results: [result] };
    expect(OutboxWorkerReportSchema.safeParse(report).success).toBe(true);
    expect(
      OutboxWorkerReportSchema.safeParse({
        ...report,
        results: [result, result],
      }).success,
    ).toBe(false);
    const { expectedVersion: _expectedVersion, ...staleResult } = result;
    expect(
      OutboxWorkerReportSchema.safeParse({
        ...report,
        results: [staleResult],
      }).success,
    ).toBe(false);
    expect(_expectedVersion).toBe(2);
  });

  it("uses event-specific PII-free log shapes", () => {
    expect(
      OutboxLogEventSchema.safeParse({
        event: "sent",
        outboxId: OUTBOX_ID,
        attemptCount: 1,
        errorCode: null,
      }).success,
    ).toBe(true);
    expect(
      OutboxLogEventSchema.safeParse({
        event: "retry_scheduled",
        outboxId: OUTBOX_ID,
        attemptCount: 1,
        errorCode: null,
      }).success,
    ).toBe(false);
    expect(
      OutboxLogEventSchema.safeParse({
        event: "sent",
        outboxId: OUTBOX_ID,
        attemptCount: 1,
        errorCode: null,
        recipient: "maria@example.com",
      }).success,
    ).toBe(false);
  });
});

describe("verified webhook boundary", () => {
  const headers = {
    webhookId: "evt_123",
    webhookTimestamp: "1783591200",
    webhookSignature: "v1,abcdefghijklmnopqrstuvwxyz",
  };

  it("derives the replay identity from verified headers", () => {
    const parsed = VerifiedEmailWebhookEventSchema.parse({
      verifiedHeaders: headers,
      signatureVerified: true,
      providerMessageId: "msg_123",
      eventKind: "bounced",
      payloadSha256: "A".repeat(64),
      receivedAt: "2026-07-09T10:00:00Z",
    });
    expect(parsed.providerEventId).toBe("evt_123");
    expect(parsed.payloadSha256).toBe("a".repeat(64));
    expect(parsed).not.toHaveProperty("verifiedHeaders");
    expect(
      VerifiedEmailWebhookEventSchema.safeParse({
        ...parsed,
        signatureVerified: false,
      }).success,
    ).toBe(false);
  });

  it("validates timestamp syntax and replay window", () => {
    expect(WebhookSignatureHeadersSchema.safeParse(headers).success).toBe(true);
    expect(
      WebhookSignatureHeadersSchema.safeParse({
        ...headers,
        webhookTimestamp: "not-a-time",
      }).success,
    ).toBe(false);
    expect(() =>
      assertWebhookTimestampFresh(headers, new Date(1_783_591_200_000)),
    ).not.toThrow();
    expect(() =>
      assertWebhookTimestampFresh(headers, new Date(1_783_592_000_000)),
    ).toThrow(RangeError);
  });

  it("keeps persisted webhook processing ordered", () => {
    const event = {
      providerEventId: "evt_123",
      providerMessageId: "msg_123",
      eventKind: "delivered" as const,
      payloadSha256: "a".repeat(64),
      signatureVerified: true as const,
      receivedAt: CREATED_AT,
      processedAt: "2026-07-09T10:01:00Z",
      processingErrorCode: null,
    };
    expect(EmailWebhookEventPersistenceSchema.safeParse(event).success).toBe(
      true,
    );
    expect(
      EmailWebhookEventPersistenceSchema.safeParse({
        ...event,
        processedAt: "2026-07-09T09:59:00Z",
      }).success,
    ).toBe(false);
  });
});
