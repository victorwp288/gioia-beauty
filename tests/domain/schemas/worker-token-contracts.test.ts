import { describe, expect, it } from "vitest";

import {
  OutboxClaimItemSchema,
  OutboxCompletionFailureResultSchema,
  VerifiedWebhookResultSchema,
  parseVerifiedNewsletterActionClaims,
} from "@/lib/domain/schemas/index.ts";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("newsletter action claims", () => {
  const claims = {
    version: 1,
    purpose: "newsletter_confirm",
    subscriberId: ID,
    tokenId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    issuedAt: "2026-07-09T10:00:00.000Z",
    expiresAt: "2026-07-10T10:00:00.000Z",
  };

  it("accepts verified, unexpired, purpose-bound claims", () => {
    expect(
      parseVerifiedNewsletterActionClaims(
        claims,
        "newsletter_confirm",
        new Date("2026-07-09T12:00:00.000Z"),
      ),
    ).toMatchObject({ subscriberId: ID, purpose: "newsletter_confirm" });
  });

  it("rejects wrong-purpose, expired, and overlong claims", () => {
    expect(() =>
      parseVerifiedNewsletterActionClaims(
        claims,
        "newsletter_unsubscribe",
        new Date("2026-07-09T12:00:00.000Z"),
      ),
    ).toThrow();
    expect(() =>
      parseVerifiedNewsletterActionClaims(
        claims,
        "newsletter_confirm",
        new Date("2026-07-11T12:00:00.000Z"),
      ),
    ).toThrow();
    expect(() =>
      parseVerifiedNewsletterActionClaims(
        {
          ...claims,
          expiresAt: "2026-09-10T10:00:00.000Z",
        },
        "newsletter_confirm",
      ),
    ).toThrow();
  });
});

describe("outbox worker DTOs", () => {
  const claim = {
    outboxId: ID,
    aggregateKind: "schedule_entry",
    aggregateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    aggregateVersion: 1,
    recipientKind: "customer",
    recipientAddress: "client@example.test",
    templateKind: "booking_customer",
    templateData: {
      clientName: "Cliente Test",
      localDate: "2026-08-10",
      startMinutes: 600,
      serviceDurationMinutes: 45,
      serviceName: "Servizio",
      variantName: "45 minuti",
    },
    providerIdempotencyKey: "schedule:booking:1",
    attemptCount: 1,
    expectedVersion: 2,
    leaseExpiresAt: "2026-07-09T10:02:00.000Z",
  };

  it("accepts exact claim/template correlations and completion states", () => {
    expect(OutboxClaimItemSchema.parse(claim).templateKind).toBe(
      "booking_customer",
    );
    expect(
      OutboxCompletionFailureResultSchema.parse({
        outboxId: ID,
        deliveryStatus: "failed",
        attemptCount: 1,
        currentVersion: 3,
        nextAttemptAt: "2026-07-09T10:05:00.000Z",
      }).deliveryStatus,
    ).toBe("failed");
  });

  it("rejects template/recipient drift and inconsistent webhook errors", () => {
    expect(() =>
      OutboxClaimItemSchema.parse({ ...claim, recipientKind: "owner" }),
    ).toThrow();
    expect(() =>
      VerifiedWebhookResultSchema.parse({
        processingState: "processed",
        replayed: false,
        errorCode: "PROVIDER_MESSAGE_NOT_FOUND",
      }),
    ).toThrow();
  });
});
