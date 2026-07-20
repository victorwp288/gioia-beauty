import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { observeServerRoute } from "@/lib/server/observability/runtime.ts";

const FIXED_TIME = "2026-07-10T12:34:56.000Z";
const originalTransport = process.env.OBSERVABILITY_TRANSPORT;

function setTransport(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.OBSERVABILITY_TRANSPORT;
    return;
  }
  process.env.OBSERVABILITY_TRANSPORT = value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_TIME));
});

afterEach(() => {
  vi.useRealTimers();
  setTransport(originalTransport);
});

describe("server observability runtime", () => {
  it("writes one exact, fixed-shape JSON line when console transport is enabled", async () => {
    setTransport("console");
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const response = new Response("ok", { status: 201 });
    const observed = observeServerRoute(
      "public.booking",
      "POST",
      async () => response,
    );

    await expect(observed()).resolves.toBe(response);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]).toHaveLength(1);

    const line = write.mock.calls[0]?.[0];
    expect(typeof line).toBe("string");
    const event = JSON.parse(String(line)) as Record<string, unknown>;
    expect(Object.keys(event)).toEqual([
      "v",
      "ts",
      "event",
      "route",
      "method",
      "requestId",
      "status",
      "outcome",
      "durationMs",
    ]);
    expect(event).toEqual({
      v: 1,
      ts: FIXED_TIME,
      event: "route_completed",
      route: "public.booking",
      method: "POST",
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      status: 201,
      outcome: "success",
      durationMs: expect.any(Number),
    });
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.durationMs).toBeLessThanOrEqual(300_000);
    expect(line).toBe(`${JSON.stringify(event)}\n`);
  });

  it.each([undefined, "", "stderr", "sentry", " console "])(
    "does not write when transport is %s",
    async (transport) => {
      setTransport(transport);
      const write = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const response = new Response(null, { status: 204 });
      const observed = observeServerRoute(
        "health",
        "GET",
        async () => response,
      );

      await expect(observed()).resolves.toBe(response);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it("forwards exact arguments and preserves response identity", async () => {
    setTransport(undefined);
    const request = new Request("https://example.invalid/health");
    const context = Object.freeze({ opaque: true });
    const response = new Response("healthy");
    const handler = vi.fn(
      async (_request: Request, _context: typeof context) => response,
    );
    const observed = observeServerRoute("health", "GET", handler);

    await expect(observed(request, context)).resolves.toBe(response);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(request, context);
  });

  it("rethrows the identical business error without forwarding its contents", async () => {
    setTransport("console");
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const original = new Error("customer-secret-must-not-leak");
    const observed = observeServerRoute("public.booking", "POST", async () => {
      throw original;
    });

    await expect(observed()).rejects.toBe(original);
    expect(write).toHaveBeenCalledTimes(2);
    const output = write.mock.calls.map(([line]) => String(line)).join("");
    expect(output).not.toContain(original.message);
    expect(output).toContain('"event":"unexpected_error"');
    expect(output).toContain('"event":"route_completed"');
  });

  it("records a fixed unexpected-error event for a handled 5xx response", async () => {
    setTransport("console");
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const response = new Response(null, { status: 503 });
    const observed = observeServerRoute(
      "public.booking",
      "POST",
      async () => response,
    );

    await expect(observed()).resolves.toBe(response);
    expect(write).toHaveBeenCalledTimes(2);
    const output = write.mock.calls.map(([line]) => String(line)).join("");
    expect(output).toContain('"event":"unexpected_error"');
    expect(output).toContain('"event":"route_completed"');
    expect(output).toContain('"status":503');
  });

  it("preserves successful behavior when stdout throws", async () => {
    setTransport("console");
    vi.spyOn(process.stdout, "write").mockImplementation(() => {
      throw new Error("stdout failure");
    });
    const response = new Response("ok");
    const observed = observeServerRoute("health", "GET", async () => response);

    await expect(observed()).resolves.toBe(response);
  });

  it("absorbs an asynchronously rejecting stdout result", async () => {
    setTransport("console");
    vi.spyOn(process.stdout, "write").mockImplementation(
      () => Promise.reject(new Error("stdout rejection")) as never,
    );
    const response = new Response("ok");
    const observed = observeServerRoute("health", "GET", async () => response);

    await expect(observed()).resolves.toBe(response);
    await Promise.resolve();
    await Promise.resolve();
  });

  it("preserves successful behavior when the environment cannot be read", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "env");
    expect(descriptor).toBeDefined();
    const response = new Response("ok");
    const observed = observeServerRoute("health", "GET", async () => response);
    let result: Response | undefined;

    Object.defineProperty(process, "env", {
      configurable: true,
      get() {
        throw new Error("environment failure");
      },
    });
    try {
      result = await observed();
    } finally {
      Object.defineProperty(process, "env", descriptor!);
    }

    expect(result).toBe(response);
  });
});

describe("server observability runtime source boundary", () => {
  const path = resolve("lib/server/observability/runtime.ts");
  const source = readFileSync(path, "utf8");
  const sinkStart = source.indexOf("function writeStructuredLine");
  const sinkEnd = source.indexOf("\n}", sinkStart);

  it("is server-only, small, and defers its sole environment read to the sink", () => {
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source.split("\n").length).toBeLessThanOrEqual(300);
    expect(source.match(/process\.env/g)).toHaveLength(1);
    expect(source.match(/process\.stdout\.write/g)).toHaveLength(1);
    expect(sinkStart).toBeGreaterThan(0);
    expect(source.indexOf("process.env")).toBeGreaterThan(sinkStart);
    expect(source.indexOf("process.env")).toBeLessThan(sinkEnd);
    expect(source.indexOf("process.stdout.write")).toBeGreaterThan(sinkStart);
    expect(source.indexOf("process.stdout.write")).toBeLessThan(sinkEnd);
    expect(source).toContain("sink: null");
  });

  it("contains no provider, client, inspection, or side-effect machinery", () => {
    expect(source).not.toMatch(/console\.|fetch\s*\(|@sentry|\bdsn\b/i);
    expect(source).not.toMatch(/\b(?:setTimeout|setInterval|queueMicrotask)\b/);
    expect(source).not.toMatch(/\b(?:cache|retry)\b/i);
    expect(source).not.toMatch(/\.(?:body|cookies|headers|status|url)\b/);
    expect(source).not.toMatch(/\b(?:NextRequest|Request)\b/);
  });
});
