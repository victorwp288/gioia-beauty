import "server-only";

import { createHash } from "node:crypto";

import type { LegacyFirestoreReverseOperation } from "./legacyFirestoreReverseContract.ts";

const MAX_REVERSE_OPERATIONS = 500;

export interface LegacyFirestoreReversePlan {
  readonly afterSequence: number;
  readonly throughSequence: number;
  readonly complete: boolean;
  readonly operations: readonly LegacyFirestoreReverseOperation[];
}

export interface LegacyFirestoreReverseSink {
  applyBatch(
    operations: readonly LegacyFirestoreReverseOperation[],
  ): Promise<void>;
}

export interface LegacyFirestoreReverseCheckpointLease {
  readonly afterSequence: number;
  advance(next: number): Promise<boolean>;
  release(): Promise<void>;
}

export interface LegacyFirestoreReverseCheckpoint {
  claim(
    expected: number,
  ): Promise<LegacyFirestoreReverseCheckpointLease | null>;
}

function operationChecksum(operation: LegacyFirestoreReverseOperation) {
  if (operation.action === "delete") {
    return createHash("sha256")
      .update(`delete\0${operation.collection}\0${operation.documentId}`)
      .digest("hex");
  }
  return createHash("sha256")
    .update(JSON.stringify(operation.payload))
    .digest("hex");
}

function assertPlan(plan: LegacyFirestoreReversePlan): void {
  if (
    !Number.isInteger(plan.afterSequence) ||
    plan.afterSequence < 0 ||
    !Number.isInteger(plan.throughSequence) ||
    plan.throughSequence < plan.afterSequence ||
    !Array.isArray(plan.operations) ||
    plan.operations.length > MAX_REVERSE_OPERATIONS
  ) {
    throw new Error("REVERSE_EXECUTION_PLAN_INVALID");
  }
  const targets = new Set<string>();
  for (const operation of plan.operations) {
    const key = `${operation.collection}:${operation.documentId}`;
    if (
      targets.has(key) ||
      operation.sourceSequenceId <= plan.afterSequence ||
      operation.sourceSequenceId > plan.throughSequence ||
      operation.payloadSha256 !== operationChecksum(operation) ||
      (operation.action === "set" &&
        (operation.merge !== true || operation.payload === null)) ||
      (operation.action === "delete" &&
        (operation.merge !== false || operation.payload !== null))
    ) {
      throw new Error("REVERSE_EXECUTION_PLAN_INVALID");
    }
    targets.add(key);
  }
}

export async function executeLegacyFirestoreReversePlan(
  plan: LegacyFirestoreReversePlan,
  sink: LegacyFirestoreReverseSink,
  checkpoint: LegacyFirestoreReverseCheckpoint,
) {
  assertPlan(plan);
  const lease = await checkpoint.claim(plan.afterSequence);
  if (!lease) {
    throw new Error("REVERSE_CHECKPOINT_MISMATCH");
  }
  if (lease.afterSequence !== plan.afterSequence) {
    await lease.release();
    throw new Error("REVERSE_CHECKPOINT_MISMATCH");
  }
  try {
    if (plan.throughSequence === plan.afterSequence) {
      if (plan.operations.length !== 0) {
        throw new Error("REVERSE_EXECUTION_PLAN_INVALID");
      }
      return Object.freeze({
        throughSequence: plan.afterSequence,
        operations: 0,
        complete: plan.complete,
      });
    }
    if (plan.operations.length === 0) {
      throw new Error("REVERSE_EXECUTION_PLAN_INVALID");
    }

    await sink.applyBatch(Object.freeze([...plan.operations]));
    if (!(await lease.advance(plan.throughSequence))) {
      throw new Error("REVERSE_CHECKPOINT_ADVANCE_FAILED");
    }
    return Object.freeze({
      throughSequence: plan.throughSequence,
      operations: plan.operations.length,
      complete: plan.complete,
    });
  } finally {
    await lease.release();
  }
}
