import "server-only";

export const OUTBOX_CLAIM_PROVIDER_CUTOFF_MS = 16_000;
export const OUTBOX_WORKER_SETTLEMENT_CUTOFF_MS = 24_000;
export const OUTBOX_INVOCATION_DEADLINE_MS = 25_000;

export type DeadlineResult<T> =
  | { readonly status: "settled"; readonly value: T }
  | { readonly status: "aborted" };

export interface DeadlineSignal {
  readonly signal: AbortSignal;
  cleanup(): void;
}

export function createDeadlineSignal(
  timeoutMs: number,
  parent?: AbortSignal,
): DeadlineSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

export function settleBeforeAbort<T>(
  operation: PromiseLike<T>,
  signal: AbortSignal,
): Promise<DeadlineResult<T>> {
  if (signal.aborted) return Promise.resolve({ status: "aborted" });

  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (result: DeadlineResult<T>) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ status: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });

    Promise.resolve(operation).then(
      (value) => finish({ status: "settled", value }),
      (error) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function mapWithConcurrency<T, R>(
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
