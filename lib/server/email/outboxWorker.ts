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

export {
  OutboxWorkerConfigurationError,
  OutboxWorkerSummarySchema,
} from "./outboxWorkerContracts.ts";

type WorkerOutcome =
  | "sent"
  | "retry_scheduled"
  | "delivery_dead_lettered"
  | "completion_uncertain";

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
const PROVIDER_CUTOFF_MS = 16_000;
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
): Promise<WorkerOutcome> {
  try {
    const completion = await repository.completeFailure({
      outboxId: item.outboxId,
      expectedVersion: item.expectedVersion,
      workerId,
      errorCode,
      retryable,
    });
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
  signal: AbortSignal,
): Promise<WorkerOutcome> {
  let message: EmailMessage;
  try {
    const parsedItem = OutboxClaimItemSchema.parse(item);
    const render = dependencies.renderers[parsedItem.templateKind];
    if (!render) throw new Error("Missing renderer");
    message = render(parsedItem);
  } catch {
    return persistFailure(
      dependencies.repository,
      workerId,
      item,
      "OUTBOX_TEMPLATE_INVALID",
      false,
    );
  }

  let providerResult: unknown;
  if (signal.aborted) {
    return persistFailure(
      dependencies.repository,
      workerId,
      item,
      "PROVIDER_TIMEOUT",
      true,
    );
  }
  try {
    providerResult = await dependencies.provider.send(message, {
      idempotencyKey: item.providerIdempotencyKey,
      signal,
    });
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
    return persistFailure(
      dependencies.repository,
      workerId,
      item,
      result.errorCode,
      result.retryable,
    );
  }

  try {
    const completion = await dependencies.repository.completeSuccess({
      outboxId: item.outboxId,
      expectedVersion: item.expectedVersion,
      workerId,
      providerMessageId: result.providerMessageId,
    });
    return completionMatches(completion, item)
      ? "sent"
      : "completion_uncertain";
  } catch {
    return "completion_uncertain";
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await operation(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function countOutcomes(summary: WorkerSummary, outcomes: WorkerOutcome[]) {
  for (const outcome of outcomes) {
    if (outcome === "sent") summary.sent += 1;
    if (outcome === "retry_scheduled") summary.retryScheduled += 1;
    if (outcome === "delivery_dead_lettered") {
      summary.deliveryDeadLettered += 1;
    }
    if (outcome === "completion_uncertain") summary.completionUncertain += 1;
  }
}

export function createOutboxWorker(dependencies: WorkerDependencies) {
  requireCompleteRenderer(dependencies.renderers);
  return {
    async run(input: z.input<typeof WorkerConfigurationSchema>) {
      const configuration = WorkerConfigurationSchema.parse(input);
      const providerController = new AbortController();
      const providerTimer = setTimeout(
        () => providerController.abort(),
        PROVIDER_CUTOFF_MS,
      );
      const summary: WorkerSummary = {
        claimCycles: 0,
        claimed: 0,
        sent: 0,
        retryScheduled: 0,
        deliveryDeadLettered: 0,
        completionUncertain: 0,
        budgetReached: false,
      };

      try {
        const claims = requireClaimBatch(
          await dependencies.repository.claim({
            workerId: configuration.workerId,
            batchSize: BATCH_SIZE,
            leaseSeconds: LEASE_SECONDS,
          }),
        );
        summary.claimCycles = 1;
        summary.claimed = claims.length;
        summary.budgetReached = claims.length === BATCH_SIZE;
        const outcomes = await mapWithConcurrency(claims, CONCURRENCY, (item) =>
          processClaim(
            dependencies,
            configuration.workerId,
            item,
            providerController.signal,
          ),
        );
        countOutcomes(summary, outcomes);
      } finally {
        clearTimeout(providerTimer);
      }

      return OutboxWorkerSummarySchema.parse(summary);
    },
  };
}

export type OutboxWorker = ReturnType<typeof createOutboxWorker>;
