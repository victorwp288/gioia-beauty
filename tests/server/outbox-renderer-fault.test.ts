import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OutboxRendererOperationalError,
  isOutboxRendererOperationalError,
} from "@/lib/server/email/outboxRendererFault.ts";

describe("outbox renderer operational fault contract", () => {
  it("recognizes only branded instances and subclasses", () => {
    class SpecializedFault extends OutboxRendererOperationalError {}
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("properties must not be inspected");
        },
      },
    );

    expect(
      isOutboxRendererOperationalError(new OutboxRendererOperationalError()),
    ).toBe(true);
    expect(isOutboxRendererOperationalError(new SpecializedFault())).toBe(true);
    expect(
      isOutboxRendererOperationalError({
        name: "OutboxRendererOperationalError",
        message: "Outbox rendering is temporarily unavailable",
      }),
    ).toBe(false);
    expect(isOutboxRendererOperationalError(hostile)).toBe(false);
  });

  it("shares identity branding across duplicate module evaluation", async () => {
    const original = new OutboxRendererOperationalError();
    vi.resetModules();
    const reloaded = await import("@/lib/server/email/outboxRendererFault.ts");

    expect(reloaded.isOutboxRendererOperationalError(original)).toBe(true);
    expect(
      isOutboxRendererOperationalError(
        new reloaded.OutboxRendererOperationalError(),
      ),
    ).toBe(true);
  });
});
