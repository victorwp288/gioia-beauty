import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MAX_OBSERVABILITY_DURATION_MS,
  MAX_OBSERVABILITY_LINE_BYTES,
  OBSERVED_ROUTES,
} from "@/lib/server/observability/contracts.ts";
import { createStructuredLogger } from "@/lib/server/observability/structuredLogger.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-07-10T10:11:12.345Z");
const METRIC = {
  route: "public.booking",
  method: "POST",
  requestId: REQUEST_ID,
  status: 409,
  durationMs: 23,
} as const;
const ERROR_CONTEXT = {
  route: "public.booking",
  method: "POST",
  requestId: REQUEST_ID,
} as const;

describe("structured observability logger", () => {
  it("emits the exact fixed route-completion JSONL contract", () => {
    const sink = vi.fn<(line: string) => void>();
    const logger = createStructuredLogger({ sink, now: () => NOW });

    logger.routeCompleted(METRIC);

    const expected =
      '{"v":1,"ts":"2026-07-10T10:11:12.345Z","event":"route_completed","route":"public.booking","method":"POST","requestId":"11111111-1111-4111-8111-111111111111","status":409,"outcome":"conflict","durationMs":23}\n';
    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith(expected);
    expect(expected.endsWith("\n")).toBe(true);
    expect(expected.slice(0, -1)).not.toContain("\n");
  });

  it("emits the exact fixed unexpected-error JSONL contract", () => {
    const sink = vi.fn<(line: string) => void>();
    const logger = createStructuredLogger({ sink, now: () => NOW });

    logger.unexpectedError(ERROR_CONTEXT);

    expect(sink).toHaveBeenCalledWith(
      '{"v":1,"ts":"2026-07-10T10:11:12.345Z","event":"unexpected_error","route":"public.booking","method":"POST","requestId":"11111111-1111-4111-8111-111111111111"}\n',
    );
  });

  it("keeps every maximum legal fixed line below the byte cap", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      sink: (line) => lines.push(line),
      now: () => new Date(8.64e15),
    });

    for (const route of OBSERVED_ROUTES) {
      logger.routeCompleted({
        route,
        method: "POST",
        requestId: REQUEST_ID,
        status: 599,
        durationMs: MAX_OBSERVABILITY_DURATION_MS,
      });
    }

    expect(lines).toHaveLength(OBSERVED_ROUTES.length);
    for (const line of lines) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(
        MAX_OBSERVABILITY_LINE_BYTES,
      );
      expect(line.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it.each([
    ["invalid date", () => new Date(Number.NaN)],
    ["non-date", () => ({}) as Date],
    ["proxied date", () => new Proxy(NOW, {})],
    [
      "throwing clock",
      () => {
        throw new Error("customer@example.test");
      },
    ],
  ])("drops events for a %s", (_label, now) => {
    const sink = vi.fn();
    const logger = createStructuredLogger({ sink, now });

    expect(() => logger.routeCompleted(METRIC)).not.toThrow();
    expect(() => logger.unexpectedError(ERROR_CONTEXT)).not.toThrow();
    expect(sink).not.toHaveBeenCalled();
  });

  it("swallows synchronous sink failures", () => {
    const sink = vi.fn(() => {
      throw new Error("customer@example.test");
    });
    const logger = createStructuredLogger({ sink, now: () => NOW });

    expect(() => logger.routeCompleted(METRIC)).not.toThrow();
    expect(() => logger.unexpectedError(ERROR_CONTEXT)).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("absorbs rejected sink promises", async () => {
    const sink = vi.fn(() =>
      Promise.reject(new Error("customer@example.test")),
    );
    const logger = createStructuredLogger({ sink, now: () => NOW });

    expect(() => logger.routeCompleted(METRIC)).not.toThrow();
    expect(() => logger.unexpectedError(ERROR_CONTEXT)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("absorbs a rejecting thenable that throws after rejection", async () => {
    const then = vi.fn(
      (
        _resolve: (value: unknown) => void,
        reject: (reason: unknown) => void,
      ) => {
        reject(new Error("customer@example.test"));
        throw new Error("customer@example.test");
      },
    );
    const sink = vi.fn(() => ({ then }));
    const logger = createStructuredLogger({ sink, now: () => NOW });

    expect(() => logger.routeCompleted(METRIC)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(then).toHaveBeenCalledOnce();
  });

  it("rejects secret-bearing shapes without reading or logging them", () => {
    const secret = "customer@example.test";
    const getter = vi.fn(() => secret);
    const sink = vi.fn<(line: string) => void>();
    const logger = createStructuredLogger({ sink, now: () => NOW });
    const accessorMetric = { ...METRIC };
    Object.defineProperty(accessorMetric, "secret", {
      enumerable: true,
      get: getter,
    });

    logger.routeCompleted({ ...METRIC, secret });
    logger.routeCompleted(accessorMetric);
    logger.unexpectedError({ ...ERROR_CONTEXT, error: new Error(secret) });
    logger.routeCompleted(METRIC);

    expect(getter).not.toHaveBeenCalled();
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0]?.[0]).not.toContain(secret);
  });

  it("returns a frozen logger and tolerates a non-function sink", () => {
    const logger = createStructuredLogger({
      sink: null as unknown as (line: string) => unknown,
      now: () => NOW,
    });

    expect(Object.isFrozen(logger)).toBe(true);
    expect(Reflect.set(logger, "routeCompleted", vi.fn())).toBe(false);
    expect(() => logger.routeCompleted(METRIC)).not.toThrow();
    expect(() => logger.unexpectedError(ERROR_CONTEXT)).not.toThrow();
  });
});
