import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRuntimePaginationCursorCodec } from "@/lib/server/paginationCursorRuntime.ts";
import { PaginationCursorConfigurationError } from "@/lib/server/paginationCursorKeyring.ts";

import { ENTITY_ID, FINGERPRINT, NOW } from "./pagination-cursor-fixture.ts";

const SECONDARY_SECRET = Buffer.alloc(32, 0x24).toString("base64url");

function issue(codec: ReturnType<typeof createRuntimePaginationCursorCodec>) {
  return codec.issue({
    position: {
      scope: "schedule.list",
      date: "2026-07-10",
      startMinutes: 600,
      id: ENTITY_ID,
    },
    filterFingerprint: FINGERPRINT,
    pageSize: 50,
    now: NOW,
  });
}

describe("runtime pagination cursor configuration", () => {
  it.each(["local", "test"])(
    "provides a deterministic %s-only fallback key",
    (appEnvironment) => {
      const codec = createRuntimePaginationCursorCodec({
        APP_ENV: appEnvironment,
      });
      const token = issue(codec);

      expect(token.startsWith("c1-local_1.")).toBe(true);
      expect(
        codec.verify({
          token,
          expectedScope: "schedule.list",
          filterFingerprint: FINGERPRINT,
          pageSize: 50,
          now: NOW,
        }).ok,
      ).toBe(true);
    },
  );

  it("accepts an explicit bounded rotation keyring", () => {
    const configuration = JSON.stringify({
      activeKeyId: "active_1",
      keys: [
        { id: "active_1", secret: SECONDARY_SECRET },
        {
          id: "previous_1",
          secret: Buffer.alloc(32, 0x25).toString("base64url"),
        },
      ],
    });

    expect(
      issue(
        createRuntimePaginationCursorCodec({
          APP_ENV: "preview",
          PAGINATION_CURSOR_KEYRING_JSON: configuration,
        }),
      ).startsWith("c1-active_1."),
    ).toBe(true);
  });

  it.each([
    ["missing remote configuration", { APP_ENV: "preview" }],
    [
      "surrounding whitespace",
      { APP_ENV: "preview", PAGINATION_CURSOR_KEYRING_JSON: " {}" },
    ],
    [
      "malformed JSON",
      { APP_ENV: "preview", PAGINATION_CURSOR_KEYRING_JSON: "{" },
    ],
    [
      "oversized configuration",
      {
        APP_ENV: "preview",
        PAGINATION_CURSOR_KEYRING_JSON: "x".repeat(4_097),
      },
    ],
  ] as const)("rejects %s", (_caseName, environment) => {
    expect(() => createRuntimePaginationCursorCodec(environment)).toThrow(
      PaginationCursorConfigurationError,
    );
  });
});
