import "server-only";

// Sinks are trusted in-process adapters. This is best-effort containment for
// ordinary accidental Promise/PromiseLike returns, not a sandbox for arbitrary
// code or poisoned native promises.
export function swallowSinkResult(result: unknown): void {
  try {
    if (
      result !== null &&
      (typeof result === "object" || typeof result === "function")
    ) {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Observability must never change business behavior.
  }
}

export function safelyInvokeSink<Values extends readonly unknown[]>(
  sink: (...values: Values) => unknown,
  values: Values,
): void {
  try {
    swallowSinkResult(Reflect.apply(sink, undefined, values));
  } catch {
    // Observability must never change business behavior.
  }
}
