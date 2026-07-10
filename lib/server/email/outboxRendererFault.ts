import "server-only";

const BRAND_KEY = Symbol.for("gioia.outbox-renderer-operational-errors.v1");

type BrandedGlobal = typeof globalThis & {
  [BRAND_KEY]?: WeakSet<object>;
};

function brandedErrors(): WeakSet<object> {
  const shared = globalThis as BrandedGlobal;
  shared[BRAND_KEY] ??= new WeakSet<object>();
  return shared[BRAND_KEY];
}

export class OutboxRendererOperationalError extends Error {
  constructor() {
    super("Outbox rendering is temporarily unavailable");
    this.name = "OutboxRendererOperationalError";
    brandedErrors().add(this);
  }
}

export function isOutboxRendererOperationalError(
  value: unknown,
): value is OutboxRendererOperationalError {
  return (typeof value === "object" && value !== null) ||
    typeof value === "function"
    ? brandedErrors().has(value)
    : false;
}
