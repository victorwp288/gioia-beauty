import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  VerifiedEmailWebhookEventSchema,
  type VerifiedEmailWebhookEvent,
} from "@/lib/domain/schemas/index.ts";
import { createVerifiedEmailWebhookRepository } from "@/lib/server/database/verifiedEmailWebhookRepository.ts";
import type {
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

const event = VerifiedEmailWebhookEventSchema.parse({
  verifiedHeaders: {
    webhookId: "evt_synthetic_0001",
    webhookTimestamp: "2054282400",
    webhookSignature: "v1,c3ludGhldGljLXNpZ25hdHVyZQ==",
  },
  signatureVerified: true,
  providerMessageId: "msg_synthetic_0001",
  eventKind: "bounced" as const,
  payloadSha256: "81".repeat(32),
  receivedAt: "2035-02-05T10:00:00.000Z",
});

function setup(rows: Array<Record<string, unknown>>) {
  const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => rows);
  const transaction = vi.fn(
    async (work: (transaction: RuntimeTransaction) => unknown) =>
      work({ unsafe } as RuntimeTransaction),
  );
  return {
    repository: createVerifiedEmailWebhookRepository({
      transaction: transaction as RuntimeDatabase["transaction"],
    }),
    transaction,
    unsafe,
  };
}

describe("verified email webhook repository", () => {
  it("passes only verified reduced fields to one bounded private command", async () => {
    const fixture = setup([
      { processing_state: "processed", replayed: false, error_code: null },
    ]);

    await expect(fixture.repository.processVerified(event)).resolves.toEqual({
      processingState: "processed",
      replayed: false,
      errorCode: null,
    });

    expect(fixture.transaction).toHaveBeenCalledOnce();
    expect(fixture.unsafe).toHaveBeenCalledOnce();
    const [query, parameters] = fixture.unsafe.mock.calls[0]!;
    expect(query).toContain("gioia_private.process_verified_email_webhook");
    expect(query).toContain("$1::text, $2::text, $3::text");
    expect(query).toContain("$4::bytea, $5::timestamptz");
    expect(query).toContain("limit 2");
    expect(parameters).toEqual([
      "evt_synthetic_0001",
      "msg_synthetic_0001",
      "bounced",
      Buffer.alloc(32, 0x81),
      "2035-02-05T10:00:00.000Z",
    ]);
  });

  it("passes a nullable provider message only for a verified reduced event", async () => {
    const fixture = setup([
      { processing_state: "processed", replayed: false, error_code: null },
    ]);
    await fixture.repository.processVerified({
      ...event,
      providerMessageId: null,
      eventKind: "other",
    });
    expect(fixture.unsafe.mock.calls[0]?.[1]?.[1]).toBeNull();
  });

  it.each([
    ["processed replay", "processed", true, null],
    ["missing message", "error", false, "MESSAGE_ID_REQUIRED"],
    ["unknown message", "error", true, "PROVIDER_MESSAGE_NOT_FOUND"],
  ] as const)(
    "accepts the exact %s result contract",
    async (_label, processingState, replayed, errorCode) => {
      const fixture = setup([
        {
          processing_state: processingState,
          replayed,
          error_code: errorCode,
        },
      ]);
      await expect(fixture.repository.processVerified(event)).resolves.toEqual({
        processingState,
        replayed,
        errorCode,
      });
    },
  );

  it.each([
    ["no row", []],
    [
      "multiple rows",
      [
        { processing_state: "processed", replayed: false, error_code: null },
        { processing_state: "processed", replayed: true, error_code: null },
      ],
    ],
    [
      "extra field",
      [
        {
          processing_state: "processed",
          replayed: false,
          error_code: null,
          payload: "hidden",
        },
      ],
    ],
    [
      "unknown error code",
      [
        {
          processing_state: "error",
          replayed: false,
          error_code: "UNEXPECTED_DATABASE_DETAIL",
        },
      ],
    ],
    [
      "invalid correlation",
      [
        {
          processing_state: "processed",
          replayed: false,
          error_code: "MESSAGE_ID_REQUIRED",
        },
      ],
    ],
  ] as const)("rejects %s", async (_label, rows) => {
    const fixture = setup([...rows]);
    await expect(fixture.repository.processVerified(event)).rejects.toThrow(
      "Unexpected verified webhook result",
    );
  });

  it("rejects malformed verified input before database work", async () => {
    const fixture = setup([]);
    for (const invalid of [
      { ...event, payloadSha256: "not-a-sha256" },
      { ...event, signatureVerified: false },
      { ...event, recipient: "private@example.test" },
    ]) {
      await expect(
        fixture.repository.processVerified(
          invalid as unknown as VerifiedEmailWebhookEvent,
        ),
      ).rejects.toThrow();
    }
    expect(fixture.transaction).not.toHaveBeenCalled();
  });

  it("propagates SQL errors for the redacting HTTP boundary", async () => {
    const databaseError = Object.assign(new Error("WEBHOOK_EVENT_ID_REUSED"), {
      code: "PT409",
    });
    const transaction = vi.fn(async () => {
      throw databaseError;
    });
    const repository = createVerifiedEmailWebhookRepository({
      transaction: transaction as RuntimeDatabase["transaction"],
    });

    await expect(repository.processVerified(event)).rejects.toBe(databaseError);
  });
});
