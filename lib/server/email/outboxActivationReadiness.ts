import "server-only";

import { z } from "zod";

export const OUTBOX_ACTIVATION_READINESS_CONTRACT_VERSION = 2 as const;

const OutboxActivationProofsSchema = z.tuple([
  z
    .object({
      code: z.literal("CLAIM_DISPOSITIONS_PROVEN"),
      artifact: z.literal("claim-dispositions-v2"),
    })
    .strict(),
  z
    .object({
      code: z.literal("DEAD_LETTER_MONITOR_PROVEN"),
      artifact: z.literal("dead-letter-monitor-v1"),
    })
    .strict(),
  z
    .object({
      code: z.literal("RETRY_CUTOFF_PROVEN"),
      artifact: z.literal("provider-retry-window-v1"),
    })
    .strict(),
  z
    .object({
      code: z.literal("NEWSLETTER_SNAPSHOT_PROVEN"),
      artifact: z.literal("newsletter-confirmation-snapshot-v1"),
    })
    .strict(),
]);

const TestManifestSchema = z
  .object({
    artifact: z.literal("greenfield-test-reviewed-manifest-v2"),
    projectRef: z.literal("hzibzwhrwmljgjjdzspi"),
    reviewedManifestSha256: z.literal(
      "17b9428bd0ee692b7e15223d9b909ae4982a953e898058d175239ebd2b021d2c",
    ),
    migrationCount: z.literal(68),
    pgtapFiles: z.literal(31),
    pgtapAssertions: z.literal(475),
  })
  .strict();

export const OutboxActivationReadinessSchema = z
  .object({
    contractVersion: z.literal(OUTBOX_ACTIVATION_READINESS_CONTRACT_VERSION),
    gate: z.literal("outbox_worker_scheduler"),
    scope: z.literal("non_production_test"),
    ready: z.literal(true),
    productionReady: z.literal(false),
    proofs: OutboxActivationProofsSchema,
    testManifest: TestManifestSchema,
  })
  .strict();

export type OutboxActivationReadiness = z.infer<
  typeof OutboxActivationReadinessSchema
>;

function freezeReadiness(
  readiness: OutboxActivationReadiness,
): Readonly<OutboxActivationReadiness> {
  for (const proof of readiness.proofs) Object.freeze(proof);
  Object.freeze(readiness.proofs);
  Object.freeze(readiness.testManifest);
  return Object.freeze(readiness);
}

const CURRENT_READINESS = freezeReadiness(
  OutboxActivationReadinessSchema.parse({
    contractVersion: OUTBOX_ACTIVATION_READINESS_CONTRACT_VERSION,
    gate: "outbox_worker_scheduler",
    scope: "non_production_test",
    ready: true,
    productionReady: false,
    proofs: [
      {
        code: "CLAIM_DISPOSITIONS_PROVEN",
        artifact: "claim-dispositions-v2",
      },
      {
        code: "DEAD_LETTER_MONITOR_PROVEN",
        artifact: "dead-letter-monitor-v1",
      },
      {
        code: "RETRY_CUTOFF_PROVEN",
        artifact: "provider-retry-window-v1",
      },
      {
        code: "NEWSLETTER_SNAPSHOT_PROVEN",
        artifact: "newsletter-confirmation-snapshot-v1",
      },
    ],
    testManifest: {
      artifact: "greenfield-test-reviewed-manifest-v2",
      projectRef: "hzibzwhrwmljgjjdzspi",
      reviewedManifestSha256:
        "17b9428bd0ee692b7e15223d9b909ae4982a953e898058d175239ebd2b021d2c",
      migrationCount: 68,
      pgtapFiles: 31,
      pgtapAssertions: 475,
    },
  }),
);

/**
 * Code-owned acceptance record for non-production outbox exercise only.
 * Production remains separately blocked by environment and provider gates.
 */
export function getOutboxActivationReadiness(): Readonly<OutboxActivationReadiness> {
  return CURRENT_READINESS;
}
