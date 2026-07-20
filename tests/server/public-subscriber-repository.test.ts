import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicSubscriberRepository } from "@/lib/server/database/publicSubscriberRepository.ts";
import type {
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

const SUBSCRIBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDEMPOTENCY_KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMAIL = "reader@subscriber.test";

type Repository = ReturnType<typeof createPublicSubscriberRepository>;
type Method = "subscribe" | "confirm" | "unsubscribe";

function row(
  httpStatus: 202 | 400 = 202,
  code: "REQUEST_ACCEPTED" | "PUBLIC_EMAIL_INVALID" = "REQUEST_ACCEPTED",
  replayed = false,
) {
  return {
    http_status: httpStatus,
    result: { code },
    replayed,
  };
}

function subscribeInput() {
  return {
    principalScopeHash: Buffer.alloc(32, 0x11),
    requestFingerprint: Buffer.alloc(32, 0x21),
    command: {
      idempotencyKey: IDEMPOTENCY_KEY.toUpperCase(),
      email: `  ${EMAIL.toUpperCase()}  `,
      consent: true as const,
    },
  };
}

function actionInput(method: "confirm" | "unsubscribe" = "confirm") {
  return {
    principalScopeHash: Buffer.alloc(32, 0x31),
    requestFingerprint: Buffer.alloc(32, 0x41),
    idempotencyKey: IDEMPOTENCY_KEY.toUpperCase(),
    signingKeyId: "local_1",
    claims: {
      version: 1 as const,
      purpose:
        method === "confirm"
          ? ("newsletter_confirm" as const)
          : ("newsletter_unsubscribe" as const),
      tokenId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      subscriberId: SUBSCRIBER_ID.toUpperCase(),
      subscriberVersion: 7,
      issuedAt: "2035-02-05T10:00:00.000Z",
      expiresAt: "2035-02-06T10:00:00.000Z",
    },
  };
}

function setup(rows: Array<Record<string, unknown>>) {
  const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => rows);
  const transaction = vi.fn(
    async (work: (transaction: RuntimeTransaction) => unknown) =>
      work({ unsafe } as RuntimeTransaction),
  );
  return {
    repository: createPublicSubscriberRepository({
      transaction: transaction as RuntimeDatabase["transaction"],
    }),
    transaction,
    unsafe,
  };
}

function execute(repository: Repository, method: Method, input: unknown) {
  if (method === "subscribe") {
    return repository.subscribe(
      input as Parameters<Repository["subscribe"]>[0],
    );
  }
  if (method === "confirm") {
    return repository.confirm(input as Parameters<Repository["confirm"]>[0]);
  }
  return repository.unsubscribe(
    input as Parameters<Repository["unsubscribe"]>[0],
  );
}

function expectedQuery(method: Method) {
  if (method === "subscribe") {
    return {
      functionName: "subscribe_public_newsletter",
      signature: "$1::bytea, $2::text, $3::bytea, $4::text",
    };
  }
  return {
    functionName:
      method === "confirm"
        ? "confirm_public_newsletter"
        : "unsubscribe_public_newsletter",
    signature:
      "$1::uuid, $2::integer, $3::uuid, $4::integer, $5::timestamptz, $6::timestamptz, $7::text, $8::bytea, $9::text, $10::bytea",
  };
}

const ACCEPTED_CASES = (
  [
    ["subscribe", 202, "REQUEST_ACCEPTED"],
    ["subscribe", 400, "PUBLIC_EMAIL_INVALID"],
    ["confirm", 202, "REQUEST_ACCEPTED"],
    ["unsubscribe", 202, "REQUEST_ACCEPTED"],
  ] as const
).flatMap(([method, httpStatus, code]) =>
  ([false, true] as const).map((replayed) => ({
    method,
    httpStatus,
    code,
    replayed,
  })),
);

describe("public subscriber repository", () => {
  it.each(ACCEPTED_CASES)(
    "maps $method $httpStatus/$code when replayed=$replayed",
    async ({ method, httpStatus, code, replayed }) => {
      const fixture = setup([
        row(
          httpStatus as 202 | 400,
          code as "REQUEST_ACCEPTED" | "PUBLIC_EMAIL_INVALID",
          replayed,
        ),
      ]);
      const input =
        method === "subscribe" ? subscribeInput() : actionInput(method);

      await expect(execute(fixture.repository, method, input)).resolves.toEqual(
        { httpStatus, code, replayed },
      );

      expect(fixture.transaction).toHaveBeenCalledOnce();
      expect(fixture.unsafe).toHaveBeenCalledOnce();
      const [query, parameters] = fixture.unsafe.mock.calls[0]!;
      const normalizedQuery = query.replaceAll(/\s+/g, " ").trim();
      const contract = expectedQuery(method);
      expect(normalizedQuery).toMatch(
        /^select command\.http_status, command\.result, command\.replayed from /i,
      );
      expect(normalizedQuery).toContain(
        `from gioia_private.${contract.functionName}(`,
      );
      expect(normalizedQuery).toContain(contract.signature);
      expect(normalizedQuery).toMatch(/\) as command limit 2$/i);

      if (method === "subscribe") {
        const subscribe = input as ReturnType<typeof subscribeInput>;
        expect(parameters).toEqual([
          subscribe.principalScopeHash,
          IDEMPOTENCY_KEY,
          subscribe.requestFingerprint,
          EMAIL,
        ]);
        expect(parameters?.[0]).not.toBe(subscribe.principalScopeHash);
        expect(parameters?.[2]).not.toBe(subscribe.requestFingerprint);
        expect(subscribe.command.email).toBe(`  ${EMAIL.toUpperCase()}  `);
        expect(subscribe.command.idempotencyKey).toBe(
          IDEMPOTENCY_KEY.toUpperCase(),
        );
      } else {
        const action = input as ReturnType<typeof actionInput>;
        expect(parameters).toEqual([
          SUBSCRIBER_ID,
          7,
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          1,
          "2035-02-05T10:00:00.000Z",
          "2035-02-06T10:00:00.000Z",
          "local_1",
          action.principalScopeHash,
          IDEMPOTENCY_KEY,
          action.requestFingerprint,
        ]);
        expect(parameters?.[7]).not.toBe(action.principalScopeHash);
        expect(parameters?.[9]).not.toBe(action.requestFingerprint);
        expect(action.claims.subscriberId).toBe(SUBSCRIBER_ID.toUpperCase());
        expect(action.idempotencyKey).toBe(IDEMPOTENCY_KEY.toUpperCase());
      }
    },
  );

  it("returns an immutable non-enumerating result", async () => {
    const fixture = setup([row()]);

    const result = await fixture.repository.subscribe(subscribeInput());

    expect(result).toEqual({
      httpStatus: 202,
      code: "REQUEST_ACCEPTED",
      replayed: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result, "replayed", true)).toBe(false);
    expect(result.replayed).toBe(false);
  });

  it("propagates database command conflicts for the future redacted handler", async () => {
    const conflict = Object.assign(new Error("IDEMPOTENCY_KEY_REUSED"), {
      code: "PT409",
    });
    const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => {
      throw conflict;
    });
    const transaction = vi.fn(
      async (work: (transaction: RuntimeTransaction) => unknown) =>
        work({ unsafe } as RuntimeTransaction),
    );
    const repository = createPublicSubscriberRepository({
      transaction: transaction as RuntimeDatabase["transaction"],
    });

    await expect(repository.subscribe(subscribeInput())).rejects.toBe(conflict);
    expect(transaction).toHaveBeenCalledOnce();
    expect(unsafe).toHaveBeenCalledOnce();
  });

  it.each([
    ["subscribe", []],
    ["confirm", []],
    ["unsubscribe", []],
    ["subscribe", [row(), row()]],
    ["confirm", [row(), row()]],
    ["unsubscribe", [row(), row()]],
    ["subscribe", [{ ...row(), extra: true }]],
    ["confirm", [{ ...row(), extra: true }]],
    ["unsubscribe", [{ ...row(), extra: true }]],
    ["subscribe", [{ ...row(), client_email: "secret@example.test" }]],
    ["confirm", [{ ...row(), subscriber_id: SUBSCRIBER_ID }]],
    ["unsubscribe", [{ ...row(), resource_id: SUBSCRIBER_ID }]],
    [
      "subscribe",
      [
        {
          ...row(),
          result: { code: "REQUEST_ACCEPTED", resource_id: SUBSCRIBER_ID },
        },
      ],
    ],
    [
      "confirm",
      [
        {
          ...row(),
          result: { code: "REQUEST_ACCEPTED", email: "secret@example.test" },
        },
      ],
    ],
    ["subscribe", [row(202, "PUBLIC_EMAIL_INVALID")]],
    ["subscribe", [row(400, "REQUEST_ACCEPTED")]],
    ["confirm", [row(400, "PUBLIC_EMAIL_INVALID")]],
    ["unsubscribe", [row(400, "PUBLIC_EMAIL_INVALID")]],
    ["confirm", [{ ...row(), replayed: "false" }]],
  ] as const)("rejects malformed $0 rows %#", async (method, rows) => {
    const fixture = setup(rows as unknown as Array<Record<string, unknown>>);
    const input =
      method === "subscribe" ? subscribeInput() : actionInput(method);

    const error = await execute(fixture.repository, method, input).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Unexpected public subscriber command result");
    expect(String(error)).not.toMatch(/secret@example\.test|subscriber_id/);
  });

  it.each([
    [
      "subscribe",
      { ...subscribeInput(), principalScopeHash: Buffer.alloc(31) },
    ],
    [
      "subscribe",
      { ...subscribeInput(), requestFingerprint: Buffer.alloc(33) },
    ],
    [
      "subscribe",
      {
        ...subscribeInput(),
        command: { ...subscribeInput().command, idempotencyKey: "invalid" },
      },
    ],
    [
      "subscribe",
      {
        ...subscribeInput(),
        command: { ...subscribeInput().command, email: "invalid" },
      },
    ],
    [
      "subscribe",
      {
        ...subscribeInput(),
        command: { ...subscribeInput().command, consent: false },
      },
    ],
    [
      "subscribe",
      {
        ...subscribeInput(),
        command: { ...subscribeInput().command, extra: true },
      },
    ],
    ["subscribe", { ...subscribeInput(), extra: true }],
    ["confirm", { ...actionInput(), principalScopeHash: Buffer.alloc(31) }],
    ["unsubscribe", { ...actionInput(), requestFingerprint: Buffer.alloc(31) }],
    [
      "confirm",
      {
        ...actionInput(),
        claims: { ...actionInput().claims, subscriberId: "invalid" },
      },
    ],
    [
      "unsubscribe",
      {
        ...actionInput(),
        idempotencyKey: "invalid",
      },
    ],
    [
      "confirm",
      {
        ...actionInput(),
        claims: { ...actionInput().claims, email: EMAIL },
      },
    ],
    [
      "unsubscribe",
      {
        ...actionInput(),
        claims: { ...actionInput().claims, token: "a.b.c" },
      },
    ],
    ["confirm", { ...actionInput(), extra: true }],
  ] as const)(
    "rejects invalid $0 input %# before database work",
    async (method, input) => {
      const fixture = setup([]);

      await expect(
        execute(fixture.repository, method, input),
      ).rejects.toThrow();
      expect(fixture.transaction).not.toHaveBeenCalled();
      expect(fixture.unsafe).not.toHaveBeenCalled();
    },
  );
});
