import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createEmailOutboxRepository } from "@/lib/server/database/emailOutboxRepository.ts";
import type {
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

const OUTBOX_ID = "10000000-0000-4000-8000-000000000001";
const AGGREGATE_ID = "20000000-0000-4000-8000-000000000001";
const WORKER_ID = "cron:30000000-0000-4000-8000-000000000001";

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    selection_ordinal: 1,
    selected_count: 1,
    candidate_limit_reached: false,
    outbox_id: OUTBOX_ID,
    disposition: "send",
    terminal_reason: null,
    aggregate_kind: "schedule_entry",
    aggregate_id: AGGREGATE_ID,
    aggregate_version: 2,
    recipient_kind: "customer",
    recipient_address: "client@example.test",
    template_kind: "booking_customer",
    template_version: 1,
    template_data: {
      client_name: "Cliente Test",
      local_date: "2035-02-05",
      start_minutes: 600,
      service_duration_minutes: 60,
      service_name: "Massaggio",
      variant_name: "Relax 60 minuti",
    },
    provider_idempotency_key: `schedule:${AGGREGATE_ID}:v2:customer`,
    attempt_count: 1,
    expected_version: 2,
    lease_expires_at: new Date("2035-02-05T10:02:00.000Z"),
    first_provider_attempt_at: null,
    provider_retry_deadline_at: null,
    ...overrides,
  };
}

function setup(rows: Array<Record<string, unknown>>) {
  const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => rows);
  const transaction = vi.fn(
    async (work: (transaction: RuntimeTransaction) => unknown) =>
      work({ unsafe } as RuntimeTransaction),
  );
  return {
    repository: createEmailOutboxRepository({
      transaction: transaction as RuntimeDatabase["transaction"],
    }),
    transaction,
    unsafe,
  };
}

describe("email outbox repository claim", () => {
  it("makes one bounded call and strictly maps snake_case snapshots", async () => {
    const fixture = setup([claimRow()]);

    await expect(
      fixture.repository.claim({
        workerId: WORKER_ID,
        batchSize: 5,
        leaseSeconds: 120,
      }),
    ).resolves.toEqual({
      selectedCount: 1,
      budgetReached: false,
      claimDeadLettered: 0,
      claims: [
        {
          outboxId: OUTBOX_ID,
          aggregateKind: "schedule_entry",
          aggregateId: AGGREGATE_ID,
          aggregateVersion: 2,
          recipientKind: "customer",
          recipientAddress: "client@example.test",
          templateKind: "booking_customer",
          templateData: {
            clientName: "Cliente Test",
            localDate: "2035-02-05",
            startMinutes: 600,
            serviceDurationMinutes: 60,
            serviceName: "Massaggio",
            variantName: "Relax 60 minuti",
          },
          providerIdempotencyKey: `schedule:${AGGREGATE_ID}:v2:customer`,
          attemptCount: 1,
          expectedVersion: 2,
          leaseExpiresAt: "2035-02-05T10:02:00.000Z",
          firstProviderAttemptAt: null,
          providerRetryDeadlineAt: null,
        },
      ],
    });

    expect(fixture.transaction).toHaveBeenCalledOnce();
    expect(fixture.unsafe).toHaveBeenCalledOnce();
    const [query, parameters] = fixture.unsafe.mock.calls[0]!;
    expect(query).toContain("gioia_private.claim_email_outbox");
    expect(query).toContain("limit 25");
    expect(parameters).toEqual([WORKER_ID, 5, 120]);
  });

  it("maps reschedule and newsletter snapshots without dropping fields", async () => {
    const reschedule = claimRow({
      selection_ordinal: 1,
      selected_count: 2,
      template_kind: "reschedule_owner",
      recipient_kind: "owner",
      recipient_address: "owner@example.test",
      template_data: {
        ...(claimRow().template_data as Record<string, unknown>),
        old_local_date: "2035-02-04",
        old_start_minutes: 540,
      },
    });
    const newsletter = claimRow({
      selection_ordinal: 2,
      selected_count: 2,
      outbox_id: "40000000-0000-4000-8000-000000000001",
      aggregate_kind: "subscriber",
      recipient_kind: "subscriber",
      template_kind: "newsletter_confirmation",
      template_data: {
        policyVersion: "newsletter-consent-v1",
        consentArtifactVersion: "newsletter-consent-v1.it-1",
        consentArtifactSha256: "a".repeat(64),
        action: {
          version: 1,
          purpose: "newsletter_confirm",
          tokenId: "50000000-0000-4000-8000-000000000001",
          issuedAt: "2035-02-05T10:00:00.000Z",
          expiresAt: "2035-02-06T10:00:00.000Z",
          signingKeyId: "local_1",
        },
      },
      provider_idempotency_key:
        "subscriber:40000000-0000-4000-8000-000000000001:v1:confirmation",
      lease_expires_at: "2035-02-05T10:02:00+00:00",
    });
    const fixture = setup([reschedule, newsletter]);

    const result = await fixture.repository.claim({
      workerId: WORKER_ID,
      batchSize: 2,
      leaseSeconds: 120,
    });

    expect(result.claims[0]?.templateData).toMatchObject({
      oldLocalDate: "2035-02-04",
      oldStartMinutes: 540,
    });
    expect(result.claims[1]?.templateData).toEqual({
      policyVersion: "newsletter-consent-v1",
      consentArtifactVersion: "newsletter-consent-v1.it-1",
      consentArtifactSha256: "a".repeat(64),
      action: expect.objectContaining({ purpose: "newsletter_confirm" }),
    });
  });

  it.each([
    ["extra row field", [claimRow({ private_value: "hidden" })]],
    [
      "extra template field",
      [
        claimRow({
          template_data: {
            ...(claimRow().template_data as Record<string, unknown>),
            client_email: "must-not-pass@example.test",
          },
        }),
      ],
    ],
    ["duplicate rows", [claimRow(), claimRow()]],
    ["invalid timestamp", [claimRow({ lease_expires_at: "not-a-date" })]],
  ] as const)("rejects %s", async (_label, rows) => {
    const fixture = setup([...rows]);
    await expect(
      fixture.repository.claim({
        workerId: WORKER_ID,
        batchSize: rows.length || 1,
        leaseSeconds: 120,
      }),
    ).rejects.toThrow();
  });

  it("rejects rows beyond the requested batch", async () => {
    const fixture = setup([
      claimRow(),
      claimRow({ outbox_id: "50000000-0000-4000-8000-000000000001" }),
    ]);

    await expect(
      fixture.repository.claim({
        workerId: WORKER_ID,
        batchSize: 1,
        leaseSeconds: 120,
      }),
    ).rejects.toThrow("Unexpected outbox claim result");
  });
});

describe("email outbox repository completion", () => {
  it("persists one validated provider success", async () => {
    const fixture = setup([
      {
        outbox_id: OUTBOX_ID,
        delivery_status: "sent",
        attempt_count: 1,
        current_version: 3,
      },
    ]);

    await expect(
      fixture.repository.completeSuccess({
        outboxId: OUTBOX_ID,
        expectedVersion: 2,
        workerId: WORKER_ID,
        providerMessageId: "provider-message-1",
      }),
    ).resolves.toEqual({
      outboxId: OUTBOX_ID,
      deliveryStatus: "sent",
      attemptCount: 1,
      currentVersion: 3,
    });

    const [query, parameters] = fixture.unsafe.mock.calls[0]!;
    expect(query).toContain("complete_email_outbox_success");
    expect(query).toContain("limit 2");
    expect(parameters).toEqual([OUTBOX_ID, 2, WORKER_ID, "provider-message-1"]);
  });

  it("persists one validated provider failure and normalizes its timestamp", async () => {
    const fixture = setup([
      {
        outbox_id: OUTBOX_ID,
        delivery_status: "failed",
        attempt_count: 2,
        current_version: 4,
        next_attempt_at: new Date("2035-02-05T10:05:00.000Z"),
      },
    ]);

    await expect(
      fixture.repository.completeFailure({
        outboxId: OUTBOX_ID,
        expectedVersion: 3,
        workerId: WORKER_ID,
        errorCode: "PROVIDER_RATE_LIMITED",
        retryable: true,
      }),
    ).resolves.toEqual({
      outboxId: OUTBOX_ID,
      deliveryStatus: "failed",
      attemptCount: 2,
      currentVersion: 4,
      nextAttemptAt: "2035-02-05T10:05:00.000Z",
    });

    const [query, parameters] = fixture.unsafe.mock.calls[0]!;
    expect(query).toContain("complete_email_outbox_failure");
    expect(parameters).toEqual([
      OUTBOX_ID,
      3,
      WORKER_ID,
      "PROVIDER_RATE_LIMITED",
      true,
    ]);
  });

  it.each([
    ["no rows", []],
    ["multiple rows", [{}, {}]],
    ["missing fields", [{ delivery_status: "sent" }]],
  ] as const)("rejects malformed completion rows: %s", async (_label, rows) => {
    const fixture = setup([...rows]);
    await expect(
      fixture.repository.completeSuccess({
        outboxId: OUTBOX_ID,
        expectedVersion: 2,
        workerId: WORKER_ID,
        providerMessageId: "provider-message-1",
      }),
    ).rejects.toThrow("Unexpected outbox completion result");
  });
});
