import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  observeRoute,
  type RouteObserverOptions,
} from "@/lib/server/observability/routeMetrics.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function fixture(overrides: Partial<RouteObserverOptions> = {}) {
  const routeCompleted = vi.fn();
  const captureUnexpected = vi.fn();
  const options: RouteObserverOptions = {
    route: "public.booking",
    method: "POST",
    logger: { routeCompleted },
    errorReporter: { captureUnexpected },
    requestId: () => REQUEST_ID,
    clock: () => 10,
    ...overrides,
  };
  return { options, routeCompleted, captureUnexpected };
}

describe("route metrics observer", () => {
  it.each([200, 400, 409, 429])(
    "records exactly one completion for returned status %i without an error capture",
    async (status) => {
      const { options, routeCompleted, captureUnexpected } = fixture();
      const response = new Response(null, { status });
      const observed = observeRoute(options, async () => response);

      await expect(observed()).resolves.toBe(response);
      expect(routeCompleted).toHaveBeenCalledOnce();
      expect(routeCompleted).toHaveBeenCalledWith({
        route: "public.booking",
        method: "POST",
        requestId: REQUEST_ID,
        status,
        durationMs: 0,
      });
      expect(captureUnexpected).not.toHaveBeenCalled();
    },
  );

  it.each([500, 503, 599])(
    "captures one fixed surrogate context for returned status %i",
    async (status) => {
      const { options, routeCompleted, captureUnexpected } = fixture();
      const response = new Response(null, { status });
      const observed = observeRoute(options, async () => response);

      await expect(observed()).resolves.toBe(response);
      expect(captureUnexpected).toHaveBeenCalledOnce();
      expect(captureUnexpected).toHaveBeenCalledWith({
        route: "public.booking",
        method: "POST",
        requestId: REQUEST_ID,
      });
      expect(routeCompleted).toHaveBeenCalledOnce();
      expect(routeCompleted).toHaveBeenCalledWith({
        route: "public.booking",
        method: "POST",
        requestId: REQUEST_ID,
        status,
        durationMs: 0,
      });
    },
  );

  it("rethrows the exact original error after one capture and one 500 completion", async () => {
    const { options, routeCompleted, captureUnexpected } = fixture();
    const original = new Error("customer-secret");
    const observed = observeRoute(options, async () => {
      throw original;
    });

    let caught: unknown;
    try {
      await observed();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
    expect(captureUnexpected).toHaveBeenCalledOnce();
    expect(captureUnexpected).toHaveBeenCalledWith({
      route: "public.booking",
      method: "POST",
      requestId: REQUEST_ID,
    });
    expect(captureUnexpected.mock.calls.flat()).not.toContain(original);
    expect(routeCompleted).toHaveBeenCalledOnce();
    expect(routeCompleted).toHaveBeenCalledWith({
      route: "public.booking",
      method: "POST",
      requestId: REQUEST_ID,
      status: 500,
      durationMs: 0,
    });
  });

  it.each([
    ["normal", [10.2, 13.8], 4],
    ["regressing", [20, 10], 0],
    ["over maximum", [0, 300_001], 300_000],
    ["nonfinite start", [Number.NaN, 25], 0],
    ["nonfinite end", [25, Number.POSITIVE_INFINITY], 0],
  ] as const)(
    "bounds %s clock durations",
    async (_label, values, durationMs) => {
      const clock = vi
        .fn<() => number>()
        .mockReturnValueOnce(values[0])
        .mockReturnValueOnce(values[1]);
      const { options, routeCompleted } = fixture({ clock });
      const observed = observeRoute(options, async () => new Response(null));

      await observed();

      expect(clock).toHaveBeenCalledTimes(2);
      expect(routeCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ durationMs }),
      );
    },
  );

  it("preserves the handler result when request-id creation fails", async () => {
    const response = new Response("ok");
    const handler = vi.fn(async () => response);
    const { options, routeCompleted, captureUnexpected } = fixture({
      requestId() {
        throw new Error("request-id failure");
      },
    });
    const observed = observeRoute(options, handler);

    await expect(observed()).resolves.toBe(response);
    expect(handler).toHaveBeenCalledOnce();
    expect(routeCompleted).not.toHaveBeenCalled();
    expect(captureUnexpected).not.toHaveBeenCalled();
  });

  it("preserves successful behavior when the completion logger throws", async () => {
    const response = new Response("ok");
    const routeCompleted = vi.fn(() => {
      throw new Error("logger failure");
    });
    const { options, captureUnexpected } = fixture({
      logger: { routeCompleted },
    });
    const observed = observeRoute(options, async () => response);

    await expect(observed()).resolves.toBe(response);
    expect(routeCompleted).toHaveBeenCalledOnce();
    expect(captureUnexpected).not.toHaveBeenCalled();
  });

  it("preserves the original failure when both observer callbacks throw", async () => {
    const original = new Error("business failure");
    const routeCompleted = vi.fn(() => {
      throw new Error("logger failure");
    });
    const captureUnexpected = vi.fn(() => {
      throw new Error("reporter failure");
    });
    const { options } = fixture({
      logger: { routeCompleted },
      errorReporter: { captureUnexpected },
    });
    const observed = observeRoute(options, async () => {
      throw original;
    });

    let caught: unknown;
    try {
      await observed();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
    expect(captureUnexpected).toHaveBeenCalledOnce();
    expect(routeCompleted).toHaveBeenCalledOnce();
  });

  it("absorbs asynchronously rejecting observer callbacks", async () => {
    const original = new Error("business failure");
    const routeCompleted = vi.fn(() =>
      Promise.reject(new Error("logger rejection")),
    );
    const captureUnexpected = vi.fn(() =>
      Promise.reject(new Error("reporter rejection")),
    );
    const { options } = fixture({
      logger: { routeCompleted },
      errorReporter: { captureUnexpected },
    });
    const observed = observeRoute(options, async () => {
      throw original;
    });

    await expect(observed()).rejects.toBe(original);
    await Promise.resolve();
    await Promise.resolve();
    expect(captureUnexpected).toHaveBeenCalledOnce();
    expect(routeCompleted).toHaveBeenCalledOnce();
  });

  it("returns the original handler when observer configuration is hostile", () => {
    const handler = vi.fn(async () => new Response("ok"));
    const options = new Proxy(fixture().options, {
      get(_target, property) {
        if (property === "route") throw new Error("configuration trap");
        return Reflect.get(_target, property);
      },
    });

    expect(observeRoute(options, handler)).toBe(handler);
  });

  it("forwards exact arguments and returns the identical response", async () => {
    const first = Object.freeze({ command: "create" });
    const second = "opaque-input";
    const response = new Response("created", { status: 201 });
    const handler = vi.fn(
      async (_first: typeof first, _second: string) => response,
    );
    const { options } = fixture();
    const observed = observeRoute(options, handler);

    await expect(observed(first, second)).resolves.toBe(response);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(first, second);
  });

  it("returns an unbranded response unchanged without invoking its hostile getter", async () => {
    const statusGetter = vi.fn(() => {
      throw new Error("status trap");
    });
    const response = Object.defineProperty({}, "status", {
      get: statusGetter,
    }) as Response;
    const { options, routeCompleted, captureUnexpected } = fixture();
    const observed = observeRoute(options, async () => response);

    await expect(observed()).resolves.toBe(response);
    expect(statusGetter).not.toHaveBeenCalled();
    expect(routeCompleted).not.toHaveBeenCalled();
    expect(captureUnexpected).not.toHaveBeenCalled();
  });

  it("drops metrics for a proxied Response without invoking proxy traps", async () => {
    const get = vi.fn(() => {
      throw new Error("proxy trap");
    });
    const response = new Proxy(new Response(null, { status: 201 }), { get });
    const { options, routeCompleted, captureUnexpected } = fixture();
    const observed = observeRoute(options, () => response);

    expect(observed()).toBe(response);
    expect(get).not.toHaveBeenCalled();
    expect(routeCompleted).not.toHaveBeenCalled();
    expect(captureUnexpected).not.toHaveBeenCalled();
  });

  it("preserves a synchronous handler's return semantics", () => {
    const response = new Response(null, { status: 204 });
    const { options, routeCompleted } = fixture();
    const observed = observeRoute(options, () => response);

    expect(observed()).toBe(response);
    expect(routeCompleted).toHaveBeenCalledOnce();
  });

  it("uses the intrinsic Response status without invoking an override", async () => {
    const statusGetter = vi.fn(() => 599);
    const response = new Response(null, { status: 201 });
    Object.defineProperty(response, "status", {
      configurable: true,
      get: statusGetter,
    });
    const { options, routeCompleted } = fixture();
    const observed = observeRoute(options, async () => response);

    await expect(observed()).resolves.toBe(response);
    expect(statusGetter).not.toHaveBeenCalled();
    expect(routeCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 201 }),
    );
  });

  it("snapshots optional observer accessors exactly once", async () => {
    const requestId = vi.fn(() => REQUEST_ID);
    const clock = vi.fn(() => 10);
    const requestIdGetter = vi.fn(() => requestId);
    const clockGetter = vi.fn(() => clock);
    const { options, routeCompleted } = fixture();
    Object.defineProperty(options, "requestId", { get: requestIdGetter });
    Object.defineProperty(options, "clock", { get: clockGetter });
    const observed = observeRoute(options, async () => new Response(null));

    await observed();

    expect(requestIdGetter).toHaveBeenCalledOnce();
    expect(clockGetter).toHaveBeenCalledOnce();
    expect(routeCompleted).toHaveBeenCalledOnce();
  });
});
