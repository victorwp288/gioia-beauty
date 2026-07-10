import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { observeRoute } from "@/lib/server/observability/routeMetrics.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function observer(overrides: Record<string, unknown> = {}) {
  const routeCompleted = vi.fn();
  const captureUnexpected = vi.fn();
  return {
    options: {
      route: "health" as const,
      method: "GET" as const,
      logger: { routeCompleted },
      errorReporter: { captureUnexpected },
      requestId: () => REQUEST_ID,
      clock: () => 10,
      ...overrides,
    },
    routeCompleted,
    captureUnexpected,
  };
}

describe("route observer compatibility", () => {
  it("reads a real NextResponse through the intrinsic Response contract", () => {
    const response = NextResponse.json({ ok: true }, { status: 201 });
    const { options, routeCompleted } = observer();
    const observed = observeRoute(options, () => response);

    expect(observed()).toBe(response);
    expect(routeCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 201 }),
    );
  });

  it("preserves an exact synchronous throw and records it once", () => {
    const original = Object.freeze({ kind: "business_failure" });
    const { options, routeCompleted, captureUnexpected } = observer();
    const observed = observeRoute(options, () => {
      throw original;
    });
    let caught: unknown;

    try {
      observed();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
    expect(captureUnexpected).toHaveBeenCalledOnce();
    expect(routeCompleted).toHaveBeenCalledOnce();
    expect(routeCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500 }),
    );
  });

  it("preserves behavior and emits nothing for an invalid generated request ID", () => {
    const response = new Response(null, { status: 204 });
    const { options, routeCompleted, captureUnexpected } = observer({
      requestId: () => "NOT-A-CANONICAL-UUID",
    });
    const observed = observeRoute(options, () => response);

    expect(observed()).toBe(response);
    expect(routeCompleted).not.toHaveBeenCalled();
    expect(captureUnexpected).not.toHaveBeenCalled();
  });

  it("contains throwing clocks and records a zero duration", () => {
    const clock = vi.fn(() => {
      throw new Error("clock failure");
    });
    const { options, routeCompleted } = observer({ clock });
    const observed = observeRoute(options, () => new Response(null));

    expect(observed()).toBeInstanceOf(Response);
    expect(clock).toHaveBeenCalledTimes(2);
    expect(routeCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: 0 }),
    );
  });
});
