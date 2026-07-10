import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MAX_OBSERVABILITY_DURATION_MS,
  classifyRouteOutcome,
  parseRouteMetricInput,
  parseUnexpectedErrorContext,
} from "@/lib/server/observability/contracts.ts";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const METRIC = {
  route: "public.booking",
  method: "POST",
  requestId: REQUEST_ID,
  status: 201,
  durationMs: 17,
} as const;
const ERROR_CONTEXT = {
  route: "public.booking",
  method: "POST",
  requestId: REQUEST_ID,
} as const;

function nullPrototypeCopy(value: Record<string, unknown>) {
  return Object.assign(Object.create(null) as Record<string, unknown>, value);
}

function strictBoundaryCandidates(base: Record<string, unknown>) {
  const withSymbol = { ...base };
  Object.defineProperty(withSymbol, Symbol("secret"), {
    enumerable: true,
    value: "customer@example.test",
  });

  const withHiddenExtra = { ...base };
  Object.defineProperty(withHiddenExtra, "secret", {
    enumerable: false,
    value: "customer@example.test",
  });

  const withHiddenExpected = { ...base };
  Object.defineProperty(withHiddenExpected, "route", {
    enumerable: false,
    value: base.route,
  });

  class BoundaryClass {
    route = base.route;
    method = base.method;
    requestId = base.requestId;
    status = base.status;
    durationMs = base.durationMs;
  }

  const throwingProxy = new Proxy(
    { ...base },
    {
      ownKeys() {
        throw new Error("customer@example.test");
      },
    },
  );
  const revoked = Proxy.revocable({ ...base }, {});
  revoked.revoke();

  return [
    null,
    undefined,
    "metric",
    [{ ...base }],
    { ...base, secret: "customer@example.test" },
    withSymbol,
    withHiddenExtra,
    withHiddenExpected,
    new BoundaryClass(),
    Object.create(base) as unknown,
    throwingProxy,
    revoked.proxy,
  ];
}

describe("observability contracts", () => {
  it("copies, normalizes, and freezes exact metric and error inputs", () => {
    const metricInput = { ...METRIC };
    const errorInput = nullPrototypeCopy({ ...ERROR_CONTEXT });
    const metric = parseRouteMetricInput(metricInput);
    const context = parseUnexpectedErrorContext(errorInput);

    expect(metric).toEqual(METRIC);
    expect(context).toEqual(ERROR_CONTEXT);
    expect(metric).not.toBe(metricInput);
    expect(context).not.toBe(errorInput);
    expect(Object.isFrozen(metric)).toBe(true);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Reflect.set(metric!, "status", 500)).toBe(false);
    expect(Reflect.set(context!, "route", "health")).toBe(false);
  });

  it.each([
    [100, 0],
    [599, MAX_OBSERVABILITY_DURATION_MS],
  ])(
    "accepts exact numeric bounds: status %i, duration %i",
    (status, durationMs) => {
      expect(parseRouteMetricInput({ ...METRIC, status, durationMs })).toEqual({
        ...METRIC,
        status,
        durationMs,
      });
    },
  );

  it.each([
    [99, 0],
    [600, 0],
    [200.5, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    ["200", 0],
    [200, -1],
    [200, MAX_OBSERVABILITY_DURATION_MS + 1],
    [200, 0.5],
    [200, Number.NaN],
    [200, Number.POSITIVE_INFINITY],
    [200, "17"],
  ])(
    "rejects invalid numeric input: status %s, duration %s",
    (status, durationMs) => {
      expect(
        parseRouteMetricInput({ ...METRIC, status, durationMs }),
      ).toBeNull();
    },
  );

  it.each([
    "00000000-0000-1000-8000-000000000000",
    "11111111-1111-2111-9111-111111111111",
    "aaaaaaaa-aaaa-3aaa-aaaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "ffffffff-ffff-5fff-8fff-ffffffffffff",
  ])("accepts a canonical lower-case request ID: %s", (requestId) => {
    expect(parseRouteMetricInput({ ...METRIC, requestId })?.requestId).toBe(
      requestId,
    );
    expect(
      parseUnexpectedErrorContext({ ...ERROR_CONTEXT, requestId })?.requestId,
    ).toBe(requestId);
  });

  it.each([
    "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    ` ${REQUEST_ID}`,
    `${REQUEST_ID} `,
    "aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa",
    "aaaaaaaa-aaaa-6aaa-8aaa-aaaaaaaaaaaa",
    "aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa",
    "aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa",
    "00000000-0000-0000-0000-000000000000",
    "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaaaaaa",
  ])("rejects a non-canonical request ID: %s", (requestId) => {
    expect(parseRouteMetricInput({ ...METRIC, requestId })).toBeNull();
    expect(
      parseUnexpectedErrorContext({ ...ERROR_CONTEXT, requestId }),
    ).toBeNull();
  });

  it.each([
    { ...METRIC, route: "public.unknown" },
    { ...METRIC, route: "PUBLIC.BOOKING" },
    { ...METRIC, method: "post" },
    { ...METRIC, method: "DELETE" },
  ])("rejects an unknown route or method: %#", (value) => {
    expect(parseRouteMetricInput(value)).toBeNull();
  });

  it("rejects every non-exact object shape for both boundaries", () => {
    for (const value of strictBoundaryCandidates({ ...METRIC })) {
      expect(() => parseRouteMetricInput(value)).not.toThrow();
      expect(parseRouteMetricInput(value)).toBeNull();
    }
    for (const value of strictBoundaryCandidates({ ...ERROR_CONTEXT })) {
      expect(() => parseUnexpectedErrorContext(value)).not.toThrow();
      expect(parseUnexpectedErrorContext(value)).toBeNull();
    }
  });

  it("rejects accessors without invoking their getters", () => {
    const metricGetter = vi.fn(() => METRIC.route);
    const contextGetter = vi.fn(() => ERROR_CONTEXT.route);
    const metric = { ...METRIC };
    const context = { ...ERROR_CONTEXT };
    Object.defineProperty(metric, "route", {
      enumerable: true,
      get: metricGetter,
    });
    Object.defineProperty(context, "route", {
      enumerable: true,
      get: contextGetter,
    });

    expect(parseRouteMetricInput(metric)).toBeNull();
    expect(parseUnexpectedErrorContext(context)).toBeNull();
    expect(metricGetter).not.toHaveBeenCalled();
    expect(contextGetter).not.toHaveBeenCalled();
  });

  it.each([
    [100, "success"],
    [399, "success"],
    [400, "client_error"],
    [409, "conflict"],
    [410, "client_error"],
    [429, "rate_limited"],
    [499, "client_error"],
    [500, "server_error"],
    [599, "server_error"],
  ] as const)("classifies status %i as %s", (status, outcome) => {
    expect(classifyRouteOutcome(status)).toBe(outcome);
  });
});
