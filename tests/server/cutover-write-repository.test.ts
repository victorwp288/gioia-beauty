import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  authorizeCutoverWrite,
  readCutoverWriteState,
} from "@/lib/server/database/cutoverWriteRepository.ts";
import type { RuntimeTransaction } from "@/lib/server/database/runtime.ts";

describe("cutover write repository", () => {
  it("reads exactly one bounded state row", async () => {
    const unsafe = vi.fn(
      async (_query: string, _parameters?: readonly unknown[]) => [
        { mode: "frozen", version: 7 },
      ],
    );
    await expect(
      readCutoverWriteState({ unsafe } as RuntimeTransaction),
    ).resolves.toEqual({ mode: "frozen", version: 7 });
    expect(unsafe).toHaveBeenCalledOnce();
    expect(unsafe.mock.calls[0]?.[0]).toContain(
      "gioia_private.get_cutover_write_state",
    );
    expect(unsafe.mock.calls[0]?.[0]).toContain("limit 2");
  });

  it("binds authorization without retaining the caller fingerprint buffer", async () => {
    const unsafe = vi.fn(
      async (_query: string, _parameters?: readonly unknown[]) => [
        {
          is_canary: true,
          canary_run_id: "10000000-0000-4000-8000-000000000001",
          canary_grant_id: "20000000-0000-4000-8000-000000000001",
        },
      ],
    );
    const fingerprint = Buffer.alloc(32, 7);
    const token = "A".repeat(43);
    await authorizeCutoverWrite({ unsafe } as RuntimeTransaction, {
      operation: "public_booking",
      idempotencyKey: "30000000-0000-4000-8000-000000000001",
      requestFingerprint: fingerprint,
      canaryToken: token,
    });
    expect(unsafe).toHaveBeenCalledOnce();
    const [query, parameters] = unsafe.mock.calls[0]!;
    expect(query).toContain("gioia_private.authorize_cutover_write");
    expect(query).toContain("limit 2");
    expect(parameters?.[3]).toBe(token);
    expect(parameters?.[2]).toEqual(fingerprint);
    expect(parameters?.[2]).not.toBe(fingerprint);
  });

  it.each([
    { label: "empty", rows: [] },
    {
      label: "duplicate",
      rows: [
        { mode: "open", version: 1 },
        { mode: "open", version: 1 },
      ],
    },
  ])("fails closed for $label state", async ({ rows }) => {
    const unsafe = vi.fn(
      async (_query: string, _parameters?: readonly unknown[]) => rows,
    );
    await expect(
      readCutoverWriteState({ unsafe } as RuntimeTransaction),
    ).rejects.toThrow("Unexpected cutover write-control result");
  });
});
