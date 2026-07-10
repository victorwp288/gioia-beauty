import "server-only";

import { z } from "zod";

import {
  OutboxTemplateKindSchema,
  WorkerIdSchema,
  type OutboxClaimItem,
} from "@/lib/domain/schemas/index.ts";

import type { EmailMessage } from "./emailProvider.ts";

export const WorkerConfigurationSchema = z
  .object({ workerId: WorkerIdSchema })
  .strict();

export const OutboxWorkerSummarySchema = z
  .object({
    claimCycles: z.number().int().min(0).max(1),
    claimed: z.number().int().min(0).max(5),
    sent: z.number().int().min(0).max(5),
    retryScheduled: z.number().int().min(0).max(5),
    deliveryDeadLettered: z.number().int().min(0).max(5),
    completionUncertain: z.number().int().min(0).max(5),
    rendererOperationalFaults: z.number().int().min(0).max(5),
    budgetReached: z.boolean(),
  })
  .strict()
  .superRefine((summary, context) => {
    if (
      summary.sent +
        summary.retryScheduled +
        summary.deliveryDeadLettered +
        summary.completionUncertain !==
      summary.claimed
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every claimed item requires one terminal worker outcome",
      });
    }
    if (
      summary.rendererOperationalFaults >
      summary.retryScheduled +
        summary.deliveryDeadLettered +
        summary.completionUncertain
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Renderer operational faults require a failure disposition",
      });
    }
  });

export type WorkerSummary = z.infer<typeof OutboxWorkerSummarySchema>;
export type OutboxEmailRenderer = (item: OutboxClaimItem) => EmailMessage;
type OutboxTemplateKind = z.infer<typeof OutboxTemplateKindSchema>;

export type OutboxEmailRendererCatalog = Partial<
  Record<OutboxTemplateKind, OutboxEmailRenderer>
>;

export class OutboxWorkerConfigurationError extends Error {
  constructor() {
    super("Outbox worker is not configured for every template kind");
    this.name = "OutboxWorkerConfigurationError";
  }
}

export function requireCompleteRenderer(renderer: OutboxEmailRendererCatalog) {
  const keys = Object.keys(renderer);
  const knownKinds = new Set<string>(OutboxTemplateKindSchema.options);
  if (
    keys.length !== OutboxTemplateKindSchema.options.length ||
    OutboxTemplateKindSchema.options.some(
      (kind) => typeof renderer[kind] !== "function",
    ) ||
    keys.some((kind) => !knownKinds.has(kind))
  ) {
    throw new OutboxWorkerConfigurationError();
  }
}
