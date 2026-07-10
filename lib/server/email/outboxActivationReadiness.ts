import "server-only";

import { z } from "zod";

export const OUTBOX_ACTIVATION_READINESS_CONTRACT_VERSION = 1 as const;

const OutboxActivationBlockersSchema = z.tuple([
  z
    .object({
      code: z.literal("CLAIM_DISPOSITIONS_UNPROVEN"),
      requiredProof: z.literal("claim-dispositions-v2"),
    })
    .strict(),
  z
    .object({
      code: z.literal("DEAD_LETTER_MONITOR_UNPROVEN"),
      requiredProof: z.literal("dead-letter-monitor-v1"),
    })
    .strict(),
  z
    .object({
      code: z.literal("RETRY_CUTOFF_UNPERSISTED"),
      requiredProof: z.literal("provider-retry-window-v1"),
    })
    .strict(),
  z
    .object({
      code: z.literal("NEWSLETTER_SNAPSHOT_UNVERSIONED"),
      requiredProof: z.literal("newsletter-confirmation-snapshot-v1"),
    })
    .strict(),
  z
    .object({
      code: z.literal("TEST_CHECKPOINT_UNPROVEN"),
      requiredProof: z.literal("greenfield-test-37-v1"),
    })
    .strict(),
]);

export const OutboxActivationReadinessSchema = z
  .object({
    contractVersion: z.literal(OUTBOX_ACTIVATION_READINESS_CONTRACT_VERSION),
    gate: z.literal("outbox_worker_scheduler"),
    ready: z.literal(false),
    blockers: OutboxActivationBlockersSchema,
  })
  .strict();

export type OutboxActivationReadiness = z.infer<
  typeof OutboxActivationReadinessSchema
>;

function freezeReadiness(
  readiness: OutboxActivationReadiness,
): Readonly<OutboxActivationReadiness> {
  for (const blocker of readiness.blockers) Object.freeze(blocker);
  Object.freeze(readiness.blockers);
  return Object.freeze(readiness);
}

const CURRENT_READINESS = freezeReadiness(
  OutboxActivationReadinessSchema.parse({
    contractVersion: OUTBOX_ACTIVATION_READINESS_CONTRACT_VERSION,
    gate: "outbox_worker_scheduler",
    ready: false,
    blockers: [
      {
        code: "CLAIM_DISPOSITIONS_UNPROVEN",
        requiredProof: "claim-dispositions-v2",
      },
      {
        code: "DEAD_LETTER_MONITOR_UNPROVEN",
        requiredProof: "dead-letter-monitor-v1",
      },
      {
        code: "RETRY_CUTOFF_UNPERSISTED",
        requiredProof: "provider-retry-window-v1",
      },
      {
        code: "NEWSLETTER_SNAPSHOT_UNVERSIONED",
        requiredProof: "newsletter-confirmation-snapshot-v1",
      },
      {
        code: "TEST_CHECKPOINT_UNPROVEN",
        requiredProof: "greenfield-test-37-v1",
      },
    ],
  }),
);

/**
 * Code-owned launch stop. V1 accepts no evidence and cannot report ready.
 * A future success path requires a new contract plus verifier-backed proofs.
 */
export function getOutboxActivationReadiness(): Readonly<OutboxActivationReadiness> {
  return CURRENT_READINESS;
}
