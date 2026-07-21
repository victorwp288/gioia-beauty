import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicAbuseRepository } from "@/lib/server/database/publicAbuseRepository.ts";
import type {
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

function fixture(rows: Array<Record<string, unknown>>) {
  const unsafe = vi.fn(
    async (_query: string, _parameters?: readonly unknown[]) => rows,
  );
  const transaction = vi.fn(
    async <T>(work: (transaction: RuntimeTransaction) => Promise<T>) =>
      work({ unsafe }),
  );
  return {
    repository: createPublicAbuseRepository({
      transaction,
    } as Pick<RuntimeDatabase, "transaction">),
    unsafe,
  };
}

describe("public abuse repository", () => {
  it("passes the exact account scope and human result to one bounded function", async () => {
    const runtime = fixture([
      {
        decision: "allowed",
        allowed: true,
        remaining: 2,
        retry_after_seconds: 0,
        human_verification_required: false,
      },
    ]);
    const scopeHash = Buffer.alloc(32, 0x42);

    await expect(
      runtime.repository.consume({
        action: "public_booking",
        scopeKind: "account",
        scopeHash,
        humanVerified: true,
      }),
    ).resolves.toEqual({
      decision: "allowed",
      allowed: true,
      remaining: 2,
      retryAfterSeconds: 0,
      humanVerificationRequired: false,
    });
    expect(runtime.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("consume_public_abuse_bucket"),
      ["booking", "account", scopeHash, true],
    );
    expect(runtime.unsafe.mock.calls[0]![0]).toContain("limit 2");
  });

  it("maps owner login account limits to the exact durable policy action", async () => {
    const runtime = fixture([
      {
        decision: "rate_limited",
        allowed: false,
        remaining: 0,
        retry_after_seconds: 417,
        human_verification_required: false,
      },
    ]);
    const scopeHash = Buffer.alloc(32, 0x51);

    await expect(
      runtime.repository.consume({
        action: "owner_login",
        scopeKind: "account",
        scopeHash,
        humanVerified: false,
      }),
    ).resolves.toEqual({
      decision: "rate_limited",
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 417,
      humanVerificationRequired: false,
    });
    expect(runtime.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("consume_public_abuse_bucket"),
      ["owner_login", "account", scopeHash, false],
    );
  });

  it("preserves the durable owner-login post-threshold signal for action mapping", async () => {
    const runtime = fixture([
      {
        decision: "human_verification_required",
        allowed: false,
        remaining: 2,
        retry_after_seconds: 899,
        human_verification_required: true,
      },
    ]);

    await expect(
      runtime.repository.consume({
        action: "owner_login",
        scopeKind: "network",
        scopeHash: Buffer.alloc(32, 0x52),
        humanVerified: false,
      }),
    ).resolves.toEqual({
      decision: "human_verification_required",
      allowed: false,
      remaining: 2,
      retryAfterSeconds: 899,
      humanVerificationRequired: true,
    });
  });

  it("rejects malformed scope input before database work", async () => {
    const runtime = fixture([]);
    await expect(
      runtime.repository.consume({
        action: "public_booking",
        scopeKind: "remote",
        scopeHash: Buffer.alloc(32),
        humanVerified: false,
      }),
    ).rejects.toThrow();
    expect(runtime.unsafe).not.toHaveBeenCalled();
  });

  it("rejects a contradictory database decision", async () => {
    const runtime = fixture([
      {
        decision: "allowed",
        allowed: false,
        remaining: 1,
        retry_after_seconds: 0,
        human_verification_required: false,
      },
    ]);
    await expect(
      runtime.repository.consume({
        action: "public_booking",
        scopeKind: "network",
        scopeHash: Buffer.alloc(32),
        humanVerified: false,
      }),
    ).rejects.toThrow();
  });
});
