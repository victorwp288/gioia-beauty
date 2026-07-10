import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { requestFingerprint } from "@/lib/server/bookingSecurity.ts";
import { readAdminCommandRequest } from "@/lib/server/adminCommandRequest.ts";

const CSRF_TOKEN = "A".repeat(43);
const IDEMPOTENCY_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BodySchema = z
  .object({
    clientName: z.string().trim().min(1),
    startMinutes: z.number().int(),
  })
  .strict();

function commandRequest(
  body: string | Uint8Array | ArrayBuffer | Record<string, unknown> | null = {
    clientName: "  Cliente Test  ",
    startMinutes: 600,
  },
  headers: Record<string, string> = {},
) {
  const requestBody =
    body === null ||
    typeof body === "string" ||
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer
      ? body
      : JSON.stringify(body);
  return new Request("https://preview.example.test/api/admin/appointments", {
    method: "POST",
    headers: {
      host: "preview.example.test",
      origin: "https://preview.example.test",
      "x-csrf-token": CSRF_TOKEN,
      "idempotency-key": IDEMPOTENCY_KEY,
      "content-type": "application/json",
      ...headers,
    },
    body: requestBody as BodyInit | null,
  });
}

function read(
  request: Request,
  bodySchema: z.ZodType<Record<string, unknown>> = BodySchema,
) {
  return readAdminCommandRequest({
    request,
    csrfCookieToken: CSRF_TOKEN,
    bodySchema,
    operation: "owner_create_appointment",
    version: 1,
  });
}

describe("admin command request reader", () => {
  it("returns a normalized command and a copied body-only fingerprint", async () => {
    const firstRequest = commandRequest();
    const secondRequest = commandRequest(
      { startMinutes: 600, clientName: "Cliente Test" },
      { "idempotency-key": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    );
    const first = await read(firstRequest);
    const second = await read(secondRequest);

    expect(first).toMatchObject({
      ok: true,
      command: {
        clientName: "Cliente Test",
        startMinutes: 600,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });
    expect(second.ok && first.ok && second.requestFingerprint).toEqual(
      first.ok && first.requestFingerprint,
    );
    expect(first.ok && first.requestFingerprint).toEqual(
      requestFingerprint({
        operation: "owner_create_appointment",
        version: 1,
        request: { clientName: "Cliente Test", startMinutes: 600 },
      }),
    );
    if (first.ok && second.ok) {
      first.requestFingerprint.fill(0);
      expect(second.requestFingerprint).not.toEqual(first.requestFingerprint);
      expect(second.requestFingerprint).toHaveLength(32);
    }
  });

  it.each([
    ["cross-origin", { origin: "https://attacker.example.test" }, CSRF_TOKEN],
    ["missing origin", { origin: "" }, CSRF_TOKEN],
    ["wrong CSRF", {}, "B".repeat(43)],
  ])(
    "rejects %s before reading or validating the body",
    async (_label, headers, csrf) => {
      const request = commandRequest(undefined, headers);
      const getReader = vi.spyOn(request.body!, "getReader");
      const schema = { safeParse: vi.fn() } as unknown as z.ZodType<
        Record<string, unknown>
      >;

      await expect(
        readAdminCommandRequest({
          request,
          csrfCookieToken: csrf,
          bodySchema: schema,
          operation: "owner_create_appointment",
          version: 1,
        }),
      ).resolves.toEqual({
        ok: false,
        status: 403,
        code: "FORBIDDEN_REQUEST",
      });
      expect(getReader).not.toHaveBeenCalled();
      expect(schema.safeParse).not.toHaveBeenCalled();
    },
  );

  it("keeps idempotency, CSRF, and identity outside the normalized body", async () => {
    const permissiveSchema = z.object({}).passthrough();
    for (const reserved of ["idempotencyKey", "csrfToken", "identity"]) {
      await expect(
        read(commandRequest({ [reserved]: "must-not-pass" }), permissiveSchema),
      ).resolves.toEqual({
        ok: false,
        status: 422,
        code: "INVALID_REQUEST",
      });
    }
  });

  it("rejects reserved raw fields before a default Zod object strips them", async () => {
    const strippingSchema = z.object({
      clientName: z.string(),
      startMinutes: z.number(),
    });
    await expect(
      read(
        commandRequest({
          clientName: "Cliente Test",
          startMinutes: 600,
          identity: "must-not-be-stripped",
        }),
        strippingSchema,
      ),
    ).resolves.toEqual({
      ok: false,
      status: 422,
      code: "INVALID_REQUEST",
    });
  });

  it.each([
    ["", 1],
    ["UPPERCASE", 1],
    ["a".repeat(65), 1],
    ["owner_create_appointment", 0],
    ["owner_create_appointment", 1.5],
    ["owner_create_appointment", Number.NaN],
    ["owner_create_appointment", Number.POSITIVE_INFINITY],
    ["owner_create_appointment", 2_147_483_648],
  ])(
    "rejects invalid fingerprint domain %j/%s before reading",
    async (operation, version) => {
      const request = commandRequest();
      const getReader = vi.spyOn(request.body!, "getReader");
      await expect(
        readAdminCommandRequest({
          request,
          csrfCookieToken: CSRF_TOKEN,
          bodySchema: BodySchema,
          operation,
          version,
        }),
      ).rejects.toThrow("fingerprint domain is invalid");
      expect(getReader).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["", "IDEMPOTENCY_KEY_REQUIRED"],
    ["not-a-uuid", "INVALID_IDEMPOTENCY_KEY"],
    ["A".repeat(36), "INVALID_IDEMPOTENCY_KEY"],
    ["x".repeat(129), "INVALID_IDEMPOTENCY_KEY"],
    [`${IDEMPOTENCY_KEY}, ${IDEMPOTENCY_KEY}`, "INVALID_IDEMPOTENCY_KEY"],
  ])("rejects non-canonical idempotency key %s", async (key, code) => {
    const request = commandRequest(undefined, { "idempotency-key": key });
    const getReader = vi.spyOn(request.body!, "getReader");

    await expect(read(request)).resolves.toEqual({
      ok: false,
      status: 400,
      code,
    });
    expect(getReader).not.toHaveBeenCalled();
  });

  it.each([
    [{ "content-type": "text/plain" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [
      { "content-type": "application/json", "content-encoding": "gzip" },
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ],
    [{ "content-length": "invalid" }, 400, "INVALID_REQUEST"],
    [{ "content-length": "8193" }, 413, "PAYLOAD_TOO_LARGE"],
  ])(
    "rejects headers before reading body: %j",
    async (headers, status, code) => {
      const request = commandRequest(undefined, headers);
      const getReader = vi.spyOn(request.body!, "getReader");

      await expect(read(request)).resolves.toEqual({ ok: false, status, code });
      expect(getReader).not.toHaveBeenCalled();
    },
  );

  it.each([
    [new Uint8Array([0xc3, 0x28]), 400, "INVALID_JSON"],
    ["{not-json", 400, "INVALID_JSON"],
    [
      JSON.stringify({ clientName: "x", startMinutes: 600, extra: true }),
      422,
      "INVALID_REQUEST",
    ],
    ["x".repeat(8 * 1_024 + 1), 413, "PAYLOAD_TOO_LARGE"],
  ])(
    "rejects invalid or oversized observed body",
    async (body, status, code) => {
      await expect(read(commandRequest(body))).resolves.toEqual({
        ok: false,
        status,
        code,
      });
    },
  );
});
