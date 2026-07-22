import { describe, expect, it, vi } from "vitest";

import { clearLocalPhase4OwnerLoginAbuse } from "../../scripts/local-phase4-owner-abuse-isolation.mjs";

function fixtureDatabase(resolver) {
  const unsafe = vi.fn(resolver);
  return {
    begin: vi.fn(async (operation) => operation({ unsafe })),
    unsafe,
  };
}

describe("Local Phase 4 owner abuse isolation", () => {
  it("deletes only the two exact synthetic owner-login hashes", async () => {
    const foreignHash = Buffer.alloc(32, 0xff);
    const database = fixtureDatabase(async (query, parameters) => {
      if (query.includes("delete from gioia_private.public_abuse_buckets")) {
        expect(query).toContain("bucket.action = 'owner_login'");
        expect(query).toContain("bucket.hmac_key_id = 'public_v1'");
        expect(query).toContain("bucket.scope_hash = $1::bytea");
        expect(query).toContain("bucket.scope_hash = $2::bytea");
        expect(parameters).toHaveLength(3);
        expect(parameters[0]).toBeInstanceOf(Buffer);
        expect(parameters[1]).toBeInstanceOf(Buffer);
        expect(parameters[0]).not.toEqual(parameters[1]);
        expect(parameters).not.toContainEqual(foreignHash);
        return [
          {
            action: "owner_login",
            scope_kind: "network",
            hmac_key_id: "public_v1",
            scope_hash: Buffer.from(parameters[0]),
          },
          {
            action: "owner_login",
            scope_kind: "account",
            hmac_key_id: "public_v1",
            scope_hash: Buffer.from(parameters[1]),
          },
        ];
      }
      return [];
    });

    await expect(
      clearLocalPhase4OwnerLoginAbuse(database),
    ).resolves.toBeUndefined();
    expect(database.begin).toHaveBeenCalledOnce();
    expect(database.unsafe).toHaveBeenCalledTimes(4);
  });

  it("rolls back instead of hiding duplicate or unknown fixture residue", async () => {
    const database = fixtureDatabase(async (query, parameters) => {
      if (!query.includes("delete from gioia_private.public_abuse_buckets")) {
        return [];
      }
      return ["network", "network", "account"].map((scopeKind, index) => ({
        action: "owner_login",
        scope_kind: scopeKind,
        hmac_key_id: "public_v1",
        scope_hash: Buffer.from(parameters[index === 2 ? 1 : 0]),
      }));
    });

    await expect(clearLocalPhase4OwnerLoginAbuse(database)).rejects.toThrow(
      "Unexpected Local owner abuse fixture residue",
    );
    expect(database.unsafe).toHaveBeenCalledTimes(3);
  });
});
