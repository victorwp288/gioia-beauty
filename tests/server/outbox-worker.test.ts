import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OutboxClaimItemSchema } from "@/lib/domain/schemas/index.ts";
import { createFakeEmailProvider } from "@/lib/server/email/emailProvider.ts";
import { scheduleEmailRenderersV1 } from "@/lib/server/email/emailTemplatesV1.ts";
import {
  OutboxWorkerConfigurationError,
  createOutboxWorker,
} from "@/lib/server/email/outboxWorker.ts";

const WORKER_ID = "cron:30000000-0000-4000-8000-000000000001";
const completeRenderers = {
  ...scheduleEmailRenderersV1,
  newsletter_confirmation: (item: ReturnType<typeof claim>) => ({
    from: "Gioia Beauty <noreply@gioiabeauty.net>" as const,
    to: [item.recipientAddress],
    subject: "Conferma newsletter sintetica",
    html: "<p>Conferma sintetica</p>",
    text: "Conferma sintetica",
  }),
} as const;

function uuid(index: number) {
  return `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function claim(index = 1, overrides: Record<string, unknown> = {}) {
  const aggregateId = `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return OutboxClaimItemSchema.parse({
    outboxId: uuid(index),
    aggregateKind: "schedule_entry",
    aggregateId,
    aggregateVersion: 2,
    recipientKind: "customer",
    recipientAddress: `client-${index}@example.test`,
    templateKind: "booking_customer",
    templateData: {
      clientName: `Cliente Test ${index}`,
      localDate: "2035-02-05",
      startMinutes: 600,
      serviceDurationMinutes: 60,
      serviceName: "Massaggio",
      variantName: "Relax 60 minuti",
    },
    providerIdempotencyKey: `schedule:${aggregateId}:v2:customer`,
    attemptCount: 1,
    expectedVersion: 2,
    leaseExpiresAt: "2035-02-05T10:02:00.000Z",
    ...overrides,
  });
}

function successfulCompletion(input: {
  outboxId: string;
  expectedVersion: number;
}) {
  return {
    outboxId: input.outboxId,
    deliveryStatus: "sent" as const,
    attemptCount: 1,
    currentVersion: input.expectedVersion + 1,
  };
}

function setup(claimBatches: ReturnType<typeof claim>[][]) {
  const claimItems = vi.fn();
  for (const batch of claimBatches) claimItems.mockResolvedValueOnce(batch);
  const completeSuccess = vi.fn(async (input) => successfulCompletion(input));
  const completeFailure = vi.fn(async (input) => ({
    outboxId: input.outboxId,
    deliveryStatus: input.retryable
      ? ("failed" as const)
      : ("dead_letter" as const),
    attemptCount: 1,
    currentVersion: input.expectedVersion + 1,
    nextAttemptAt: "2035-02-05T10:05:00.000Z",
  }));
  return {
    repository: { claim: claimItems, completeSuccess, completeFailure },
    claimItems,
    completeSuccess,
    completeFailure,
  };
}

describe("bounded outbox worker", () => {
  it("claims bounded cycles, sends deterministic messages, and completes each row", async () => {
    const fixture = setup([[claim(1), claim(2)]]);
    const provider = createFakeEmailProvider();
    const send = vi.spyOn(provider, "send");
    const worker = createOutboxWorker({
      repository: fixture.repository,
      provider,
      renderers: completeRenderers,
    });

    await expect(worker.run({ workerId: WORKER_ID })).resolves.toEqual({
      claimCycles: 1,
      claimed: 2,
      sent: 2,
      retryScheduled: 0,
      deliveryDeadLettered: 0,
      completionUncertain: 0,
      budgetReached: false,
    });

    expect(fixture.claimItems).toHaveBeenNthCalledWith(1, {
      workerId: WORKER_ID,
      batchSize: 5,
      leaseSeconds: 120,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[1]?.idempotencyKey).toBe(
      claim(1).providerIdempotencyKey,
    );
    expect(send.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fixture.completeSuccess).toHaveBeenCalledTimes(2);
  });

  it("isolates provider failures and durably classifies retry versus dead letter", async () => {
    const fixture = setup([[claim(1), claim(2)]]);
    fixture.completeFailure
      .mockResolvedValueOnce({
        outboxId: claim(1).outboxId,
        deliveryStatus: "failed",
        attemptCount: 1,
        currentVersion: 3,
        nextAttemptAt: "2035-02-05T10:05:00.000Z",
      })
      .mockResolvedValueOnce({
        outboxId: claim(2).outboxId,
        deliveryStatus: "dead_letter",
        attemptCount: 1,
        currentVersion: 3,
        nextAttemptAt: "2035-02-05T10:00:00.000Z",
      });
    const provider = {
      send: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          errorCode: "PROVIDER_RATE_LIMITED",
          retryable: true,
        })
        .mockResolvedValueOnce({
          ok: false,
          errorCode: "PROVIDER_REQUEST_INVALID",
          retryable: false,
        }),
    };
    const worker = createOutboxWorker({
      repository: fixture.repository,
      provider,
      renderers: completeRenderers,
    });

    const result = await worker.run({ workerId: WORKER_ID });
    expect(result).toMatchObject({
      claimed: 2,
      sent: 0,
      retryScheduled: 1,
      deliveryDeadLettered: 1,
      completionUncertain: 0,
    });
    expect(fixture.completeFailure.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        errorCode: "PROVIDER_RATE_LIMITED",
        retryable: true,
      }),
      expect.objectContaining({
        errorCode: "PROVIDER_REQUEST_INVALID",
        retryable: false,
      }),
    ]);
  });

  it("rejects incomplete renderer capability before claiming any row", () => {
    const fixture = setup([]);
    const provider = createFakeEmailProvider();
    const send = vi.spyOn(provider, "send");

    expect(() =>
      createOutboxWorker({
        repository: fixture.repository,
        provider,
        renderers: scheduleEmailRenderersV1,
      }),
    ).toThrow(OutboxWorkerConfigurationError);
    expect(fixture.claimItems).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(fixture.completeFailure).not.toHaveBeenCalled();
  });

  it("dispatches newsletter rows only through an explicit newsletter renderer", async () => {
    const newsletter = claim(1, {
      aggregateKind: "subscriber",
      recipientKind: "subscriber",
      templateKind: "newsletter_confirmation",
      templateData: { policyVersion: "newsletter-consent-v1" },
      providerIdempotencyKey:
        "subscriber:20000000-0000-4000-8000-000000000001:v2:confirmation",
    });
    const fixture = setup([[newsletter]]);
    const newsletterRenderer = vi.fn(completeRenderers.newsletter_confirmation);
    const worker = createOutboxWorker({
      repository: fixture.repository,
      provider: createFakeEmailProvider(),
      renderers: {
        ...completeRenderers,
        newsletter_confirmation: newsletterRenderer,
      },
    });

    await expect(worker.run({ workerId: WORKER_ID })).resolves.toMatchObject({
      claimed: 1,
      sent: 1,
    });
    expect(newsletterRenderer).toHaveBeenCalledOnce();
  });

  it("marks provider-accepted rows uncertain when completion cannot be proven", async () => {
    const fixture = setup([[claim(1)]]);
    fixture.completeSuccess.mockRejectedValueOnce(
      new Error("synthetic database detail"),
    );
    const worker = createOutboxWorker({
      repository: fixture.repository,
      provider: createFakeEmailProvider(),
      renderers: completeRenderers,
    });

    await expect(worker.run({ workerId: WORKER_ID })).resolves.toMatchObject({
      claimed: 1,
      sent: 0,
      completionUncertain: 1,
    });
    expect(fixture.completeFailure).not.toHaveBeenCalled();
  });

  it("never exceeds configured provider concurrency", async () => {
    const fixture = setup([[claim(1), claim(2), claim(3), claim(4), claim(5)]]);
    let active = 0;
    let maximumActive = 0;
    const provider = {
      send: vi.fn(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { ok: true as const, providerMessageId: `fake-${Date.now()}` };
      }),
    };
    const worker = createOutboxWorker({
      repository: fixture.repository,
      provider,
      renderers: completeRenderers,
    });

    await worker.run({ workerId: WORKER_ID });
    expect(maximumActive).toBe(5);
  });

  it("caps one invocation at one five-row claim", async () => {
    const batches = Array.from({ length: 5 }, (_, cycle) =>
      Array.from({ length: 5 }, (_, offset) => claim(cycle * 5 + offset + 1)),
    );
    const fixture = setup(batches);
    const worker = createOutboxWorker({
      repository: fixture.repository,
      provider: createFakeEmailProvider(),
      renderers: completeRenderers,
    });

    await expect(worker.run({ workerId: WORKER_ID })).resolves.toMatchObject({
      claimCycles: 1,
      claimed: 5,
      sent: 5,
      budgetReached: true,
    });
    expect(fixture.claimItems).toHaveBeenCalledTimes(1);
  });

  it("does not call the provider when a slow claim reaches the send cutoff", async () => {
    vi.useFakeTimers();
    try {
      const fixture = setup([]);
      fixture.claimItems.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve([claim(1)]), 16_001),
          ),
      );
      const provider = createFakeEmailProvider();
      const send = vi.spyOn(provider, "send");
      const worker = createOutboxWorker({
        repository: fixture.repository,
        provider,
        renderers: completeRenderers,
      });

      const resultPromise = worker.run({ workerId: WORKER_ID });
      await vi.advanceTimersByTimeAsync(16_001);
      await expect(resultPromise).resolves.toMatchObject({
        claimed: 1,
        sent: 0,
        retryScheduled: 1,
      });
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates configuration before database work and propagates claim outages", async () => {
    const fixture = setup([]);
    const worker = createOutboxWorker({
      repository: fixture.repository,
      provider: createFakeEmailProvider(),
      renderers: completeRenderers,
    });

    await expect(
      worker.run({ workerId: "invalid worker id" }),
    ).rejects.toThrow();
    expect(fixture.claimItems).not.toHaveBeenCalled();

    fixture.claimItems.mockRejectedValueOnce(new Error("synthetic outage"));
    await expect(worker.run({ workerId: WORKER_ID })).rejects.toThrow(
      "synthetic outage",
    );
  });
});
