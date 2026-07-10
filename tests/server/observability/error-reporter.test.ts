import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createErrorReporter,
  UnexpectedServerError,
  type ErrorCaptureSink,
} from "@/lib/server/observability/errorReporter.ts";

const CONTEXT = {
  route: "public.booking",
  method: "POST",
  requestId: "11111111-1111-4111-8111-111111111111",
} as const;

function rejectingThenable(): PromiseLike<never> {
  return {
    then() {
      throw new Error("malicious thenable");
    },
  };
}

describe("unexpected server error reporter", () => {
  it("creates a fresh fixed surrogate and a frozen copied context per capture", () => {
    const captures: Parameters<ErrorCaptureSink>[] = [];
    const sink: ErrorCaptureSink = (error, context) => {
      captures.push([error, context]);
    };
    const unexpectedError = vi.fn();
    const reporter = createErrorReporter({ sink, logger: { unexpectedError } });

    reporter.captureUnexpected({ ...CONTEXT });
    reporter.captureUnexpected({ ...CONTEXT });

    expect(captures).toHaveLength(2);
    const [firstError, firstContext] = captures[0] ?? [];
    const [secondError, secondContext] = captures[1] ?? [];
    expect(firstError).toBeInstanceOf(UnexpectedServerError);
    expect(firstError).not.toBe(secondError);
    expect(firstError).toMatchObject({
      name: "UnexpectedServerError",
      message: "UNEXPECTED_SERVER_ERROR",
    });
    expect(firstError).not.toHaveProperty("cause");
    expect(firstError?.stack).not.toContain("customer-secret");
    expect(firstContext).toEqual(CONTEXT);
    expect(firstContext).not.toBe(CONTEXT);
    expect(Object.isFrozen(firstContext)).toBe(true);
    expect(secondContext).not.toBe(firstContext);
    expect(unexpectedError).toHaveBeenCalledTimes(2);
    expect(unexpectedError.mock.calls[0]?.[0]).toBe(firstContext);
    expect(Object.isFrozen(reporter)).toBe(true);
  });

  it("does not accept or forward an original error or extra sensitive data", () => {
    const sink = vi.fn<ErrorCaptureSink>();
    const unexpectedError = vi.fn();
    const reporter = createErrorReporter({ sink, logger: { unexpectedError } });
    const original = new Error("customer-secret");

    reporter.captureUnexpected({ ...CONTEXT, original });
    reporter.captureUnexpected({
      ...CONTEXT,
      customerEmail: "secret@example.test",
    });

    expect(sink).not.toHaveBeenCalled();
    expect(unexpectedError).not.toHaveBeenCalled();
  });

  it("rejects malformed, accessor, and revoked contexts without invoking getters", () => {
    const sink = vi.fn<ErrorCaptureSink>();
    const unexpectedError = vi.fn();
    const getter = vi.fn(() => CONTEXT.requestId);
    const accessorContext = Object.defineProperties(
      {},
      {
        route: { enumerable: true, value: CONTEXT.route },
        method: { enumerable: true, value: CONTEXT.method },
        requestId: { enumerable: true, get: getter },
      },
    );
    const { proxy, revoke } = Proxy.revocable({ ...CONTEXT }, {});
    revoke();
    const reporter = createErrorReporter({ sink, logger: { unexpectedError } });

    for (const input of [
      null,
      [],
      new (class Context {
        route = CONTEXT.route;
        method = CONTEXT.method;
        requestId = CONTEXT.requestId;
      })(),
      { ...CONTEXT, requestId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
      accessorContext,
      proxy,
    ]) {
      expect(() => reporter.captureUnexpected(input)).not.toThrow();
    }

    expect(getter).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
    expect(unexpectedError).not.toHaveBeenCalled();
  });

  it("swallows throwing, rejecting, and hostile thenable sinks", async () => {
    const sinks: ErrorCaptureSink[] = [
      () => {
        throw new Error("synchronous sink failure");
      },
      () => Promise.reject(new Error("rejected sink failure")),
      () => rejectingThenable(),
      () =>
        Object.defineProperty({}, "then", {
          get() {
            throw new Error("hostile then getter");
          },
        }),
    ];

    for (const sink of sinks) {
      const reporter = createErrorReporter({
        sink,
        logger: { unexpectedError: vi.fn() },
      });
      expect(() => reporter.captureUnexpected({ ...CONTEXT })).not.toThrow();
    }
    await Promise.resolve();
    await Promise.resolve();
  });

  it("isolates a throwing logger and still attempts the capture sink", () => {
    const sink = vi.fn<ErrorCaptureSink>();
    const reporter = createErrorReporter({
      sink,
      logger: {
        unexpectedError() {
          throw new Error("logger failure");
        },
      },
    });

    expect(() => reporter.captureUnexpected({ ...CONTEXT })).not.toThrow();
    expect(sink).toHaveBeenCalledOnce();
  });

  it("absorbs an asynchronously rejecting logger and still captures", async () => {
    const sink = vi.fn<ErrorCaptureSink>();
    const reporter = createErrorReporter({
      sink,
      logger: {
        unexpectedError: (() =>
          Promise.reject(
            new Error("logger rejection"),
          )) as unknown as () => void,
      },
    });

    expect(() => reporter.captureUnexpected({ ...CONTEXT })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(sink).toHaveBeenCalledOnce();
  });
});
