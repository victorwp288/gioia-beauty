import { describe, expect, it, vi } from "vitest";

import { DATABASE_POOL_SIZE } from "../../scripts/concurrency-harness.mjs";
import { GREENFIELD_TEST_OWNER } from "../../scripts/test-target-fixture-sql.mjs";
import {
  GREENFIELD_OWNER_COOKIE_SECURITY,
  GREENFIELD_OWNER_LEDGER_SQL,
  createGreenfieldOwnerPassword,
  reconcileGreenfieldOwnerLedger,
  withGreenfieldRuntimeDatabase,
} from "../../scripts/test-target-runtime.mjs";

const CA_CERTIFICATE = "synthetic-ca-certificate";

describe("greenfield TEST ephemeral runtime fixtures", () => {
  it("generates a complex owner password from exactly 32 random bytes", () => {
    const randomBytes = vi.fn(() => Buffer.alloc(32, 0xab));
    const password = createGreenfieldOwnerPassword(randomBytes);

    expect(randomBytes).toHaveBeenCalledWith(32);
    expect(password).toMatch(/^Aa9![A-Za-z0-9_-]{43}$/u);
    expect(() => createGreenfieldOwnerPassword(() => Buffer.alloc(31))).toThrow(
      "entropy is invalid",
    );
  });

  it("pins loopback and remote Auth cookie expectations", () => {
    expect(GREENFIELD_OWNER_COOKIE_SECURITY.session.required).toContain(
      "httponly",
    );
    expect(GREENFIELD_OWNER_COOKIE_SECURITY.session.forbidden).toContain(
      "secure",
    );
    expect(GREENFIELD_OWNER_COOKIE_SECURITY.csrf.forbidden).toContain(
      "httponly",
    );
    expect(GREENFIELD_OWNER_COOKIE_SECURITY.supabase).toMatchObject({
      namePrefix: "sb-hzibzwhrwmljgjjdzspi-auth-token",
    });
    expect(GREENFIELD_OWNER_COOKIE_SECURITY.supabase.required).toContain(
      "secure",
    );
  });

  it("requires one revoked owner ledger row and no active row", async () => {
    const unsafe = vi.fn(async () => [{ total: 1, revoked: 1, active: 0 }]);
    await reconcileGreenfieldOwnerLedger({ unsafe });
    expect(unsafe).toHaveBeenCalledWith(GREENFIELD_OWNER_LEDGER_SQL, [
      GREENFIELD_TEST_OWNER.id,
    ]);

    await expect(
      reconcileGreenfieldOwnerLedger({
        unsafe: async () => [{ total: 1, revoked: 0, active: 1 }],
      }),
    ).rejects.toThrow("ledger did not reconcile");
  });

  it("closes the bounded runtime pool when its callback fails", async () => {
    const failure = new Error("synthetic runtime failure");
    const sql = { end: vi.fn(async () => {}) };
    const clientFactory = vi.fn(() => sql);

    await expect(
      withGreenfieldRuntimeDatabase(
        "postgresql://runtime.invalid",
        async (received) => {
          expect(received).toBe(sql);
          throw failure;
        },
        { caCertificate: CA_CERTIFICATE, clientFactory },
      ),
    ).rejects.toBe(failure);

    expect(clientFactory).toHaveBeenCalledWith(
      "postgresql://runtime.invalid",
      expect.objectContaining({
        connection: { application_name: "gioia_public_api" },
        max: DATABASE_POOL_SIZE,
        prepare: false,
        ssl: { ca: CA_CERTIFICATE, rejectUnauthorized: true },
      }),
    );
    expect(sql.end).toHaveBeenCalledWith({ timeout: 5 });
  });
});
