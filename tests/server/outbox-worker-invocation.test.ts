import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OutboxWorkerInvocationConfigurationError,
  createOutboxWorkerInvocationGetHandler,
} from "@/lib/server/email/outboxWorkerInvocation.ts";

const SECRET = Buffer.alloc(32, 7).toString("base64url");
const OTHER_SECRET = Buffer.alloc(32, 8).toString("base64url");
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const URL = "https://example.test/api/cron/outbox";
const SUMMARY = Object.freeze({
  claimCycles: 1,
  claimed: 2,
  claimDeadLettered: 0,
  sent: 2,
  retryScheduled: 0,
  deliveryDeadLettered: 0,
  completionUncertain: 0,
  rendererOperationalFaults: 0,
  budgetReached: false,
});

type WorkerRun = (
  input: { readonly workerId: string },
  options: { readonly signal: AbortSignal },
) => Promise<unknown>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function request({
  authorization = `Bearer ${SECRET}`,
  method = "GET",
  url = URL,
  body,
}: {
  authorization?: string | null;
  method?: string;
  url?: string;
  body?: BodyInit;
} = {}) {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);
  return new Request(url, { method, headers, body });
}

function rawAuthorizationRequest(authorization: string): Request {
  return {
    method: "GET",
    url: URL,
    headers: { get: () => authorization },
    body: null,
  } as unknown as Request;
}

function setup({
  result = SUMMARY,
  requestId = () => REQUEST_ID,
  workerRun,
}: {
  result?: unknown;
  requestId?: () => string;
  workerRun?: WorkerRun;
} = {}) {
  const run = vi.fn(workerRun ?? (async () => result));
  return {
    run,
    handler: createOutboxWorkerInvocationGetHandler({
      worker: { run },
      cronSecret: SECRET,
      requestId,
    }),
  };
}

async function json(response: Response) {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

describe("inert authenticated outbox worker invocation", () => {
  it("invokes one bounded worker with a server-derived identity", async () => {
    const fixture = setup();
    const response = await fixture.handler(request());
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      code: "OUTBOX_BATCH_PROCESSED",
      requestId: REQUEST_ID,
      summary: SUMMARY,
    });
    expect(fixture.run).toHaveBeenCalledOnce();
    expect(fixture.run).toHaveBeenCalledWith(
      { workerId: `cron:${REQUEST_ID}` },
      { signal: expect.any(AbortSignal) },
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(text).not.toContain(SECRET);
  });

  it.each([
    null,
    "",
    `bearer ${SECRET}`,
    `Bearer  ${SECRET}`,
    `Bearer ${SECRET}, Bearer ${SECRET}`,
    `Bearer ${OTHER_SECRET}`,
    `Bearer ${"a".repeat(42)}`,
    `Bearer ${"a".repeat(44)}`,
  ])(
    "rejects noncanonical authorization %# before worker work",
    async (authorization) => {
      const fixture = setup();
      const response = await fixture.handler(request({ authorization }));
      const text = await response.text();

      expect(response.status).toBe(401);
      expect(JSON.parse(text)).toMatchObject({ code: "UNAUTHORIZED" });
      expect(fixture.run).not.toHaveBeenCalled();
      expect(text).not.toContain(SECRET);
    },
  );

  it("rejects raw outer authorization whitespace before worker work", async () => {
    const fixture = setup();
    for (const authorization of [` Bearer ${SECRET}`, `Bearer ${SECRET} `]) {
      const response = await fixture.handler(
        rawAuthorizationRequest(authorization),
      );
      expect(response.status).toBe(401);
    }
    expect(fixture.run).not.toHaveBeenCalled();
  });

  it("gives authentication precedence over request-shape errors", async () => {
    const fixture = setup();
    const response = await fixture.handler(
      request({ authorization: null, method: "POST", body: "private" }),
    );

    expect(response.status).toBe(401);
    expect(await json(response)).toMatchObject({ code: "UNAUTHORIZED" });
    expect(fixture.run).not.toHaveBeenCalled();
  });

  it("rejects authenticated method, path, query, userinfo, fragment, and body variations", async () => {
    const headers = new Headers({ authorization: `Bearer ${SECRET}` });
    const bodyRequest = {
      method: "GET",
      url: URL,
      headers,
      body: new ReadableStream(),
    } as Request;
    const userInfoRequest = {
      method: "GET",
      url: "https://user@example.test/api/cron/outbox",
      headers,
      body: null,
    } as Request;
    const fragmentRequest = {
      method: "GET",
      url: `${URL}#fragment`,
      headers,
      body: null,
    } as Request;
    const cases = [
      request({ method: "POST" }),
      request({ url: "https://example.test/api/cron/other" }),
      request({ url: `${URL}?batch=25` }),
      userInfoRequest,
      fragmentRequest,
      bodyRequest,
    ];

    for (const candidate of cases) {
      const fixture = setup();
      const response = await fixture.handler(candidate);
      expect(response.status).toBe(400);
      expect(await json(response)).toMatchObject({ code: "INVALID_REQUEST" });
      expect(fixture.run).not.toHaveBeenCalled();
    }
  });

  it.each([
    undefined,
    null,
    "private-sentinel",
    Buffer.alloc(31, 1).toString("base64url"),
    Buffer.alloc(33, 1).toString("base64url"),
    Buffer.alloc(32, 1).toString("base64"),
  ])(
    "rejects invalid secret configuration %# without reflection",
    (cronSecret) => {
      let error: unknown;
      try {
        createOutboxWorkerInvocationGetHandler({
          worker: { run: vi.fn() },
          cronSecret: cronSecret as string,
          requestId: () => REQUEST_ID,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(OutboxWorkerInvocationConfigurationError);
      expect(String(error)).not.toContain(String(cronSecret));
    },
  );

  it("fails closed on invalid generated identity before worker work", async () => {
    for (const requestId of [
      () => "3AAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1",
      () => "private-sentinel",
      () => {
        throw new Error("private-sentinel");
      },
    ]) {
      const fixture = setup({ requestId });
      const response = await fixture.handler(request());
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(JSON.parse(text)).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
      expect(fixture.run).not.toHaveBeenCalled();
      expect(text).not.toContain("private-sentinel");
    }
  });

  it("returns fixed failures for worker throws, invalid output, and uncertain completion", async () => {
    const privateValue = "private-customer@example.test";
    const throwing = setup();
    throwing.run.mockRejectedValueOnce(new Error(privateValue));
    const invalid = setup({ result: { ...SUMMARY, privateValue } });
    const inconsistent = setup({
      result: { ...SUMMARY, deliveryDeadLettered: 1 },
    });
    const uncertain = setup({
      result: {
        ...SUMMARY,
        sent: 1,
        completionUncertain: 1,
      },
    });

    for (const [fixture, code] of [
      [throwing, "SERVICE_UNAVAILABLE"],
      [invalid, "SERVICE_UNAVAILABLE"],
      [inconsistent, "SERVICE_UNAVAILABLE"],
      [uncertain, "OUTBOX_COMPLETION_UNCERTAIN"],
    ] as const) {
      const response = await fixture.handler(request());
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(JSON.parse(text)).toEqual({ code, requestId: REQUEST_ID });
      expect(fixture.run).toHaveBeenCalledOnce();
      expect(text).not.toContain(privateValue);
    }
  });

  it("returns fixed renderer alerts and gives completion uncertainty precedence", async () => {
    const operational = setup({
      result: {
        ...SUMMARY,
        sent: 1,
        retryScheduled: 1,
        rendererOperationalFaults: 1,
      },
    });
    const uncertain = setup({
      result: {
        ...SUMMARY,
        sent: 0,
        retryScheduled: 1,
        completionUncertain: 1,
        rendererOperationalFaults: 1,
      },
    });

    await expect(json(await operational.handler(request()))).resolves.toEqual({
      code: "OUTBOX_RENDERER_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
    await expect(json(await uncertain.handler(request()))).resolves.toEqual({
      code: "OUTBOX_COMPLETION_UNCERTAIN",
      requestId: REQUEST_ID,
    });
  });

  it("alerts on completion-time dead letters with severity precedence", async () => {
    const deadLettered = setup({
      result: {
        ...SUMMARY,
        sent: 1,
        deliveryDeadLettered: 1,
      },
    });
    const rendererDeadLettered = setup({
      result: {
        ...SUMMARY,
        sent: 1,
        deliveryDeadLettered: 1,
        rendererOperationalFaults: 1,
      },
    });
    const uncertainDeadLettered = setup({
      result: {
        ...SUMMARY,
        sent: 0,
        deliveryDeadLettered: 1,
        completionUncertain: 1,
      },
    });

    for (const fixture of [deadLettered, rendererDeadLettered]) {
      const response = await fixture.handler(request());
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({
        code: "OUTBOX_DELIVERY_DEAD_LETTERED",
        requestId: REQUEST_ID,
      });
      expect(text).not.toContain("summary");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("x-robots-tag")).toBe(
        "noindex, nofollow, noarchive",
      );
    }
    const uncertainResponse = await uncertainDeadLettered.handler(request());
    expect(uncertainResponse.status).toBe(503);
    await expect(json(uncertainResponse)).resolves.toEqual({
      code: "OUTBOX_COMPLETION_UNCERTAIN",
      requestId: REQUEST_ID,
    });
  });

  it("keeps an ordinary scheduled retry nonterminal", async () => {
    const fixture = setup({
      result: {
        ...SUMMARY,
        sent: 1,
        retryScheduled: 1,
      },
    });
    const response = await fixture.handler(request());

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      code: "OUTBOX_BATCH_PROCESSED",
      summary: { retryScheduled: 1, deliveryDeadLettered: 0 },
    });
  });

  it("rejects operational counters without a failure disposition", async () => {
    const fixture = setup({
      result: { ...SUMMARY, rendererOperationalFaults: 1 },
    });
    const response = await fixture.handler(request());
    expect(response.status).toBe(503);
    await expect(json(response)).resolves.toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
  });

  it("returns a fixed response deadline for a non-cooperative worker", async () => {
    vi.useFakeTimers();
    try {
      let appliedSignal: AbortSignal | undefined;
      const fixture = setup({
        workerRun: async (_input, options) => {
          appliedSignal = options.signal;
          return await new Promise<never>(() => {});
        },
      });
      let settled = false;
      const responsePromise = fixture.handler(request()).finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(24_999);
      expect(settled).toBe(false);
      expect(appliedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const response = await responsePromise;

      expect(response.status).toBe(503);
      expect(await json(response)).toEqual({
        code: "SERVICE_UNAVAILABLE",
        requestId: REQUEST_ID,
      });
      expect(appliedSignal?.aborted).toBe(true);
      expect(fixture.run).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the response deadline after a last-moment valid result", async () => {
    vi.useFakeTimers();
    try {
      const pending = deferred<unknown>();
      let appliedSignal: AbortSignal | undefined;
      const fixture = setup({
        workerRun: async (_input, options) => {
          appliedSignal = options.signal;
          return await pending.promise;
        },
      });
      const responsePromise = fixture.handler(request());

      await vi.advanceTimersByTimeAsync(24_999);
      pending.resolve(SUMMARY);
      const response = await responsePromise;
      await vi.advanceTimersByTimeAsync(10_000);

      expect(response.status).toBe(200);
      expect(appliedSignal?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allocates no worker deadline for rejected requests", async () => {
    vi.useFakeTimers();
    try {
      const fixture = setup();
      const response = await fixture.handler(
        request({ authorization: null, method: "POST" }),
      );

      expect(response.status).toBe(401);
      expect(fixture.run).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a fresh server identity for each duplicate scheduler delivery", async () => {
    const ids = [
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ];
    const fixture = setup({ requestId: () => ids.shift()! });

    await fixture.handler(request());
    await fixture.handler(request());

    expect(fixture.run.mock.calls).toEqual([
      [
        { workerId: "cron:30000000-0000-4000-8000-000000000001" },
        { signal: expect.any(AbortSignal) },
      ],
      [
        { workerId: "cron:30000000-0000-4000-8000-000000000002" },
        { signal: expect.any(AbortSignal) },
      ],
    ]);
  });

  it("keeps invocation authentication independent from runtime composition", () => {
    const root = process.cwd();
    const source = [
      "lib/server/email/outboxWorkerInvocation.ts",
      "lib/server/email/outboxWorkerDeadline.ts",
    ]
      .map((path) => readFileSync(resolve(root, path), "utf8"))
      .join("\n");
    for (const forbidden of [
      "process.env",
      "createEmailProvider",
      "createEmailOutboxRepository",
      "createRuntimeDatabase",
      "RESEND_API_KEY",
      "SUPABASE_DATABASE_URL",
      "process.env.CRON_SECRET",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(existsSync(resolve(root, "app/api/cron/outbox/route.ts"))).toBe(
      true,
    );
    expect(existsSync(resolve(root, "vercel.json"))).toBe(false);
  });
});
