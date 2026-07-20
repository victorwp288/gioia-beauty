import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  executeLegacyFirestoreReversePlan,
  type LegacyFirestoreReverseCheckpoint,
  type LegacyFirestoreReversePlan,
  type LegacyFirestoreReverseSink,
} from "@/lib/server/migration/legacyFirestoreReverseExecutor.ts";

function setOperation() {
  const payload = { status: "confirmed", supabase_version: 2 };
  return {
    collection: "customers" as const,
    documentId: "legacy-appointment",
    sourceSequenceId: 8,
    aggregateId: "10000000-0000-4000-8000-000000000001",
    aggregateVersion: 2,
    action: "set" as const,
    merge: true,
    payload,
    payloadSha256: createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex"),
  };
}

function harness() {
  const documents = new Map<string, unknown>();
  let value = 3;
  let claimed = false;
  let failCheckpointOnce = true;
  const sink: LegacyFirestoreReverseSink = {
    async applyBatch(operations) {
      for (const operation of operations) {
        const key = `${operation.collection}:${operation.documentId}`;
        if (operation.action === "delete") documents.delete(key);
        else documents.set(key, structuredClone(operation.payload));
      }
    },
  };
  const checkpoint: LegacyFirestoreReverseCheckpoint = {
    async claim(expected) {
      if (claimed || value !== expected) return null;
      claimed = true;
      return {
        afterSequence: value,
        async advance(next) {
          if (failCheckpointOnce) {
            failCheckpointOnce = false;
            return false;
          }
          if (value !== expected) return false;
          value = next;
          return true;
        },
        async release() {
          claimed = false;
        },
      };
    },
  };
  return { checkpoint, documents, sink, value: () => value };
}

describe("legacy Firestore reverse executor", () => {
  it("safely replays a batch after an ambiguous checkpoint failure", async () => {
    const operation = setOperation();
    const plan: LegacyFirestoreReversePlan = {
      afterSequence: 3,
      throughSequence: 8,
      complete: true,
      operations: [operation],
    };
    const target = harness();

    await expect(
      executeLegacyFirestoreReversePlan(plan, target.sink, target.checkpoint),
    ).rejects.toThrow("REVERSE_CHECKPOINT_ADVANCE_FAILED");
    expect(target.documents.size).toBe(1);
    expect(target.value()).toBe(3);

    await expect(
      executeLegacyFirestoreReversePlan(plan, target.sink, target.checkpoint),
    ).resolves.toEqual({ throughSequence: 8, operations: 1, complete: true });
    expect(target.documents.size).toBe(1);
    expect(target.value()).toBe(8);
  });

  it("rejects tampering, stale checkpoints, and oversized batches", async () => {
    const operation = setOperation();
    const target = harness();
    await expect(
      executeLegacyFirestoreReversePlan(
        {
          afterSequence: 3,
          throughSequence: 8,
          complete: false,
          operations: [{ ...operation, payloadSha256: "0".repeat(64) }],
        },
        target.sink,
        target.checkpoint,
      ),
    ).rejects.toThrow("REVERSE_EXECUTION_PLAN_INVALID");
    await expect(
      executeLegacyFirestoreReversePlan(
        {
          afterSequence: 2,
          throughSequence: 8,
          complete: false,
          operations: [operation],
        },
        target.sink,
        target.checkpoint,
      ),
    ).rejects.toThrow("REVERSE_CHECKPOINT_MISMATCH");
    await expect(
      executeLegacyFirestoreReversePlan(
        {
          afterSequence: 3,
          throughSequence: 8,
          complete: false,
          operations: Array.from({ length: 501 }, () => operation),
        },
        target.sink,
        target.checkpoint,
      ),
    ).rejects.toThrow("REVERSE_EXECUTION_PLAN_INVALID");
  });

  it("claims the checkpoint before writes so a stale runner cannot overwrite", async () => {
    let releaseFirstWrite!: () => void;
    let firstWriteStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstWriteStarted = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let checkpointValue = 3;
    let claimed = false;
    const checkpoint: LegacyFirestoreReverseCheckpoint = {
      async claim(expected) {
        if (claimed || expected !== checkpointValue) return null;
        claimed = true;
        return {
          afterSequence: checkpointValue,
          async advance(next) {
            checkpointValue = next;
            return true;
          },
          async release() {
            claimed = false;
          },
        };
      },
    };
    const firstSink: LegacyFirestoreReverseSink = {
      async applyBatch() {
        firstWriteStarted();
        await writeGate;
      },
    };
    const staleSink: LegacyFirestoreReverseSink = {
      applyBatch: vi.fn(async () => undefined),
    };
    const plan: LegacyFirestoreReversePlan = {
      afterSequence: 3,
      throughSequence: 8,
      complete: true,
      operations: [setOperation()],
    };

    const first = executeLegacyFirestoreReversePlan(
      plan,
      firstSink,
      checkpoint,
    );
    await started;
    await expect(
      executeLegacyFirestoreReversePlan(plan, staleSink, checkpoint),
    ).rejects.toThrow("REVERSE_CHECKPOINT_MISMATCH");
    expect(staleSink.applyBatch).not.toHaveBeenCalled();
    releaseFirstWrite();
    await expect(first).resolves.toMatchObject({ throughSequence: 8 });
    expect(checkpointValue).toBe(8);
  });
});
