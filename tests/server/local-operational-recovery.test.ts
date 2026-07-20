import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createEmailDeadLetterAlertRepository } from "@/lib/server/database/emailDeadLetterAlertRepository.ts";
import type {
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";
import { createVerifiedEmailWebhookReplayRepository } from "@/lib/server/database/verifiedEmailWebhookReplayRepository.ts";
import { createFakeDeadLetterAlertReceiver } from "@/lib/server/email/fakeDeadLetterAlertReceiver.ts";

const WORKER_ID = "cron:30000000-0000-4000-8000-000000000001";
const BATCH_ID = "40000000-0000-4000-8000-000000000001";
const OUTBOX_ID = "50000000-0000-4000-8000-000000000001";

function databaseWithRows(batches: Array<Array<Record<string, unknown>>>) {
  const unsafe = vi.fn<RuntimeTransaction["unsafe"]>();
  for (const rows of batches) unsafe.mockResolvedValueOnce(rows);
  const transaction = vi.fn(
    async (work: (transaction: RuntimeTransaction) => unknown) =>
      work({ unsafe } as RuntimeTransaction),
  );
  return {
    database: { transaction } as Pick<RuntimeDatabase, "transaction">,
    unsafe,
  };
}

const alertEvent = {
  sequenceId: 7,
  outboxId: OUTBOX_ID,
  reasonCode: "OUTBOX_TEMPLATE_INVALID",
  origin: "completion",
  occurredAt: "2035-02-05T10:00:00.000Z",
};

describe("Local/Test dead-letter alert recovery", () => {
  it("claims one bounded PII-free batch and durably acknowledges its cursor", async () => {
    const fixture = databaseWithRows([
      [
        {
          batch_id: BATCH_ID,
          from_sequence_id: 7,
          through_sequence_id: 7,
          high_water_sequence_id: 7,
          event_count: 1,
          has_more: false,
          lease_expires_at: "2035-02-05T10:02:00.000Z",
          events: [alertEvent],
        },
      ],
      [{ acked_sequence_id: 7, high_water_sequence_id: 7, has_more: false }],
    ]);
    const repository = createEmailDeadLetterAlertRepository(fixture.database);
    const batch = await repository.claim({
      workerId: WORKER_ID,
      batchSize: 25,
      leaseSeconds: 120,
    });
    expect(batch.events).toEqual([alertEvent]);
    await expect(
      repository.ack({
        workerId: WORKER_ID,
        batchId: BATCH_ID,
        throughSequenceId: 7,
      }),
    ).resolves.toMatchObject({ acked_sequence_id: 7, has_more: false });
    expect(fixture.unsafe.mock.calls[0]?.[1]).toEqual([WORKER_ID, 25, 120]);
    expect(fixture.unsafe.mock.calls[1]?.[1]).toEqual([WORKER_ID, BATCH_ID, 7]);
  });

  it("fake-accepts only exact redacted events and is deterministic", async () => {
    const receiver = createFakeDeadLetterAlertReceiver();
    const first = await receiver.accept([alertEvent]);
    const second = await receiver.accept([alertEvent]);
    expect(first).toEqual(second);
    await expect(
      receiver.accept([{ ...alertEvent, recipient: "private@example.test" }]),
    ).rejects.toThrow();
  });
});

describe("bounded verified-webhook recovery", () => {
  it("maps one conserved batch without exposing provider message IDs", async () => {
    const fixture = databaseWithRows([
      [
        {
          selection_ordinal: 1,
          selected_count: 3,
          provider_event_id: "evt_1",
          processing_state: "processed",
          error_code: null,
        },
        {
          selection_ordinal: 2,
          selected_count: 3,
          provider_event_id: "evt_2",
          processing_state: "terminal",
          error_code: "WEBHOOK_REPLAY_EXHAUSTED",
        },
        {
          selection_ordinal: 3,
          selected_count: 3,
          provider_event_id: "evt_3",
          processing_state: "retry_scheduled",
          error_code: "PROVIDER_MESSAGE_NOT_FOUND",
        },
      ],
    ]);
    const repository = createVerifiedEmailWebhookReplayRepository(
      fixture.database,
    );
    await expect(repository.replay(25)).resolves.toEqual({
      selectedCount: 3,
      processedCount: 1,
      pendingCount: 1,
      terminalCount: 1,
    });
    expect(fixture.unsafe.mock.calls[0]?.[0]).not.toContain(
      "provider_message_id",
    );
    expect(fixture.unsafe.mock.calls[0]?.[1]).toEqual([25]);
  });

  it("persists fair eligibility, backoff, and a terminal disposition", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/20260720163123_phase3_webhook_replay_lifecycle_v2.sql",
      ),
      "utf8",
    );
    expect(source).toContain(
      "processing_error_code = 'PROVIDER_MESSAGE_NOT_FOUND'",
    );
    expect(source).toContain("limit p_batch_size");
    expect(source).toContain("for update skip locked");
    expect(source).toContain("process_verified_email_webhook(");
    expect(source).toContain("webhook.replay_next_attempt_at <= v_now");
    expect(source).toContain("when 4 then v_now + interval '1 hour'");
    expect(source).toContain("'WEBHOOK_REPLAY_EXHAUSTED'");
    expect(source).toContain("replay_attempt_count = 5");
    expect(source).toContain("before insert or update");
    expect(source).toContain("tg_op = 'INSERT'");
  });

  it("uses unique ordered migration versions for the recovery batch", () => {
    const files = [
      "20260720162911_phase3_signing_key_verification_semantics.sql",
      "20260720163123_phase3_webhook_replay_lifecycle_v2.sql",
    ];
    expect(new Set(files.map((file) => file.slice(0, 14))).size).toBe(2);
  });
});
