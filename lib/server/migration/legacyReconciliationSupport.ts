import "server-only";

import { createHash } from "node:crypto";

import {
  assertSourceIdentity,
  fail,
  type LegacySemanticSnapshot,
} from "./legacyReconciliationContracts.ts";

export const keyOf = (record: { sourceCollection: string; sourceId: string }) =>
  `${record.sourceCollection}\u0000${record.sourceId}`;
export const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
export const increment = (counts: Map<string, number>, key: string, by = 1) =>
  counts.set(key, (counts.get(key) ?? 0) + by);
export const sortedObject = (counts: ReadonlyMap<string, number>) =>
  Object.freeze(
    Object.fromEntries(
      [...counts].sort(([left], [right]) => left.localeCompare(right)),
    ),
  );

export function uniqueMap<
  T extends { sourceCollection: string; sourceId: string },
>(records: readonly T[], code: string) {
  const result = new Map<string, T>();
  for (const record of records) {
    assertSourceIdentity(record);
    const key = keyOf(record);
    if (result.has(key)) fail(code);
    result.set(key, record);
  }
  return result;
}

export function manifestHash<
  T extends { sourceCollection: string; sourceId: string },
>(records: readonly T[], projector: (record: T) => string) {
  return sha256(
    [...records]
      .sort((left, right) => keyOf(left).localeCompare(keyOf(right)))
      .map((record) => `${keyOf(record)}\u0000${projector(record)}`)
      .join("\n"),
  );
}

export function semanticMismatches(
  expected: LegacySemanticSnapshot,
  actual: LegacySemanticSnapshot,
) {
  const codes: string[] = [];
  if (expected.entityKind !== actual.entityKind)
    codes.push("ENTITY_KIND_MISMATCH");
  if (expected.status !== actual.status) codes.push("STATUS_MISMATCH");
  if (expected.futureConfirmed !== actual.futureConfirmed)
    codes.push("FUTURE_CONFIRMED_MISMATCH");
  if (expected.dateTimeSha256 !== actual.dateTimeSha256)
    codes.push("DATE_TIME_MISMATCH");
  if (expected.durationBufferSha256 !== actual.durationBufferSha256)
    codes.push("DURATION_BUFFER_MISMATCH");
  return codes;
}
