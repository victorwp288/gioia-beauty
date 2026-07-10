import "server-only";

import { z } from "zod";

import {
  EmailProviderResultSchema,
  type EmailMessage,
  type EmailProvider,
} from "./emailProvider.ts";
import type { EmailOutboxRepository } from "../database/emailOutboxRepository.ts";
import {
  OutboxClaimItemSchema,
  type OutboxClaimItem,
} from "@/lib/domain/schemas/index.ts";
import {
  OutboxWorkerSummarySchema,
  WorkerConfigurationSchema,
  requireCompleteRenderer,
  type OutboxEmailRendererCatalog,
  type WorkerSummary,
} from "./outboxWorkerContracts.ts";
import {
  OUTBOX_CLAIM_PROVIDER_CUTOFF_MS,
  OUTBOX_WORKER_SETTLEMENT_CUTOFF_MS,
  createDeadlineSignal,
  mapWithConcurrency,
  settleBeforeAbort,
} from "./outboxWorkerDeadline.ts";
import { isOutboxRendererOperationalError } from "./outboxRendererFault.ts";

export {
  OutboxWorkerConfigurationError,
  OutboxWorkerSummarySchema,
} from "./outboxWorkerContracts.ts";

type WorkerOutcome =
  | "sent"
  | "retry_scheduled"
  | "delivery_dead_lettered"
  | "completion_uncertain"
  | "renderer_retry_scheduled"
  | "renderer_delivery_dead_lettered"
  | "renderer_completion_uncertain";

const ACCEPTANCE_UNCERTAIN_PROVIDER_CODES = new Set([
  "PROVIDER_CONCURRENT_IDEMPOTENCY",
  "PROVIDER_NETWORK_ERROR",
  "PROVIDER_RESPONSE_INVALID",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
]);

interface WorkerDependencies {
  repository: Pick<
    EmailOutboxRepository,
    "claim" | "completeFailure" | "completeSuccess"
  >;
  provider: EmailProvider;
  renderers: OutboxEmailRendererCatalog;
}

const BATCH_SIZE = 5;
const CONCURRENCY = 5;
const LEASE_SECONDS = 120;
const ClaimBatchSchema = z
  .array(OutboxClaimItemSchema)
  .max(BATCH_SIZE)
  .superRefine((items, context) => {
    if (new Set(items.map((item) => item.outboxId)).size !== items.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Claimed outbox rows must be unique",
      });
    }
  });

function requireClaimBatch(value: unknown): OutboxClaimItem[] {
  const parsed = ClaimBatchSchema.safeParse(value);
  if (!parsed.success) throw new Error("Unexpected outbox claim batch");
  return parsed.data;
}

function completionMatches(
  completion: {
    outboxId: string;
    attemptCount: number;
    currentVersion: number;
  },
  item: OutboxClaimItem,
): boolean {
  return (
    completion.outboxId === item.outboxId &&
    completion.attemptCount === item.attemptCount &&
    completion.currentVersion === item.expectedVersion + 1
  );
}

async function persistFailure(
  repository: WorkerDependencies["repository"],
  workerId: string,
  item: OutboxClaimItem,
  errorCode: string,
  retryable: boolean,
  signal: AbortSignal,
): Promise<WorkerOutcome> {
  if (signal.aborted) return "completion_uncertain";
  try {
    const result = await settleBeforeAbort(
      repository.completeFailure({
        outboxId: item.outboxId,
        expectedVersion: item.expectedVersion,
        workerId,
        errorCode,
        retryable,
      }),
      signal,
    );
    if (result.status === "aborted") return "completion_uncertain";
    const completion = result.value;
    if (!completionMatches(completion, item)) return "completion_uncertain";
    return completion.deliveryStatus === "failed"
      ? "retry_scheduled"
      : "delivery_dead_lettered";
  } catch {
    return "completion_uncertain";
  }
}

async function processClaim(
  dependencies: WorkerDependencies,
  workerId: string,
  item: OutboxClaimItem,
  providerSignal: AbortSignal,
  settlementSignal: AbortSignal,
): Promise<WorkerOutcome> {
  let message: EmailMessage;
  try {
    const parsedItem = OutboxClaimItemSchema.parse(item);
    const render = dependencies.renderers[parsedItem.templateKind];
    if (!render) throw new Error("Missing renderer");
    message = render(parsedItem);
  } catch (error) {
    const operational = isOutboxRendererOperationalError(error);
    const outcome = await persistFailure(
      dependencies.repository,
      workerId,
      item,
      operational ? "OUTBOX_RENDERER_UNAVAILABLE" : "OUTBOX_TEMPLATE_INVALID",
      operational,
      settlementSignal,
    );
    if (!operational) return outcome;
    if (outcome === "retry_scheduled") return "renderer_retry_scheduled";
    if (outcome === "delivery_dead_lettered") {
      return "renderer_delivery_dead_lettered";
    }
    return "renderer_completion_uncertain";
  }

  let providerResult: unknown;
  if (providerSignal.aborted) {
    return persistFailure(
      dependencies.repository,
      workerId,
      item,
      "PROVIDER_TIMEOUT",
      true,
      settlementSignal,
    );
  }
  try {
    const result = await settleBeforeAbort(
      dependencies.provider.send(message, {
        idempotencyKey: item.providerIdempotencyKey,
        signal: providerSignal,
      }),
      providerSignal,
    );
    if (result.status === "aborted") return "completion_uncertain";
    providerResult = result.value;
  } catch {
    providerResult = {
      ok: false,
      errorCode: "PROVIDER_NETWORK_ERROR",
      retryable: true,
    };
  }
  const parsedResult = EmailProviderResultSchema.safeParse(providerResult);
  const result = parsedResult.success
    ? parsedResult.data
    : {
        ok: false as const,
        errorCode: "PROVIDER_RESPONSE_INVALID" as const,
        retryable: true,
      };

  if (!result.ok) {
    if (ACCEPTANCE_UNCERTAIN_PROVIDER_CODES.has(result.errorCode)) {
      return "completion_uncertain";
    }
    return persistFailure(
      dependencies.repository,
      workerId,
      item,
      result.errorCode,
      result.retryable,
      settlementSignal,
    );
  }

  if (settlementSignal.aborted) return "completion_uncertain";
  try {
    const completed = await settleBeforeAbort(
      dependencies.repository.completeSuccess({
        outboxId: item.outboxId,
        expectedVersion: item.expectedVersion,
        workerId,
        providerMessageId: result.providerMessageId,
      }),
      settlementSignal,
    );
    if (completed.status === "aborted") return "completion_uncertain";
    const completion = completed.value;
    return completionMatches(completion, item)
      ? "sent"
      : "completion_uncertain";
  } catch {
    return "completion_uncertain";
  }
}

function countOutcomes(summary: WorkerSummary, outcomes: WorkerOutcome[]) {
  for (const outcome of outcomes) {
    if (outcome === "sent") summary.sent += 1;
    if (outcome === "retry_scheduled") summary.retryScheduled += 1;
    if (outcome === "delivery_dead_lettered") {
      summary.deliveryDeadLettered += 1;
    }
    if (outcome === "completion_uncertain") summary.completionUncertain += 1;
    if (outcome === "renderer_retry_scheduled") {
      summary.retryScheduled += 1;
      summary.rendererOperationalFaults += 1;
    }
    if (outcome === "renderer_delivery_dead_lettered") {
      summary.deliveryDeadLettered += 1;
      summary.rendererOperationalFaults += 1;
    }
    if (outcome === "renderer_completion_uncertain") {
      summary.completionUncertain += 1;
      summary.rendererOperationalFaults += 1;
    }
  }
}

export function createOutboxWorker(dependencies: WorkerDependencies) {
  requireCompleteRenderer(dependencies.renderers);
  return {
    async run(
      input: z.input<typeof WorkerConfigurationSchema>,
      options: { readonly signal: AbortSignal },
    ) {
      const configuration = WorkerConfigurationSchema.parse(input);
      if (!(options?.signal instanceof AbortSignal)) {
        throw new Error("Outbox worker execution is not configured");
      }
      const providerDeadline = createDeadlineSignal(
        OUTBOX_CLAIM_PROVIDER_CUTOFF_MS,
        options.signal,
      );
      const settlementDeadline = createDeadlineSignal(
        OUTBOX_WORKER_SETTLEMENT_CUTOFF_MS,
        options.signal,
      );
      const summary: WorkerSummary = {
        claimCycles: 0,
        claimed: 0,
        sent: 0,
        retryScheduled: 0,
        deliveryDeadLettered: 0,
        completionUncertain: 0,
        rendererOperationalFaults: 0,
        budgetReached: false,
      };

      try {
        if (providerDeadline.signal.aborted) {
          throw new Error("Outbox worker claim deadline reached");
        }
        const claimed = await settleBeforeAbort(
          dependencies.repository.claim({
            workerId: configuration.workerId,
            batchSize: BATCH_SIZE,
            leaseSeconds: LEASE_SECONDS,
          }),
          providerDeadline.signal,
        );
        if (claimed.status === "aborted") {
          throw new Error("Outbox worker claim deadline reached");
        }
        const claims = requireClaimBatch(claimed.value);
        summary.claimCycles = 1;
        summary.claimed = claims.length;
        summary.budgetReached = claims.length === BATCH_SIZE;
        const outcomes = await mapWithConcurrency(claims, CONCURRENCY, (item) =>
          processClaim(
            dependencies,
            configuration.workerId,
            item,
            providerDeadline.signal,
            settlementDeadline.signal,
          ),
        );
        countOutcomes(summary, outcomes);
      } finally {
        providerDeadline.cleanup();
        settlementDeadline.cleanup();
      }

      return OutboxWorkerSummarySchema.parse(summary);
    },
  };
}

export type OutboxWorker = ReturnType<typeof createOutboxWorker>;
