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
  sent: 2,
  retryScheduled: 0,
  deliveryDeadLettered: 0,
  completionUncertain: 0,
  budgetReached: false,
});

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
}: {
  result?: unknown;
  requestId?: () => string;
} = {}) {
  const run = vi.fn(async () => result);
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
    expect(fixture.run).toHaveBeenCalledWith({
      workerId: `cron:${REQUEST_ID}`,
    });
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

  it("uses a fresh server identity for each duplicate scheduler delivery", async () => {
    const ids = [
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ];
    const fixture = setup({ requestId: () => ids.shift()! });

    await fixture.handler(request());
    await fixture.handler(request());

    expect(fixture.run.mock.calls).toEqual([
      [{ workerId: "cron:30000000-0000-4000-8000-000000000001" }],
      [{ workerId: "cron:30000000-0000-4000-8000-000000000002" }],
    ]);
  });

  it("contains no activation, environment, provider, database, or route sink", () => {
    const root = process.cwd();
    const source = readFileSync(
      resolve(root, "lib/server/email/outboxWorkerInvocation.ts"),
      "utf8",
    );
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
      false,
    );
    expect(existsSync(resolve(root, "vercel.json"))).toBe(false);
  });
});
