import { describe, expect, it, vi } from "vitest";

import { GREENFIELD_TEST_OWNER } from "../../scripts/test-target-fixture-sql.mjs";
import { GREENFIELD_TARGET_VERSIONS } from "../../scripts/test-target-migrations.mjs";
import {
  greenfieldFingerprintsMatch,
  runGreenfieldAcceptanceCycle,
} from "../../scripts/test-target-acceptance.mjs";

const fingerprint = {
  referenceChecksum: "a".repeat(64),
  schemaFingerprint: "b".repeat(64),
};
const targets = Array.from({ length: 5 }, (_, index) => ({
  localDate: `2099-01-${String(index + 4).padStart(2, "0")}`,
  serviceId: "synthetic-service",
  variantId: "synthetic-variant",
}));

function harness(overrides = {}) {
  const calls = [];
  const cli = {
    lintPrivateSchema: vi.fn(async () => calls.push("lint")),
    runAdvisors: vi.fn(async () => calls.push("advisors")),
    runRemotePgTap: vi.fn(async () => calls.push("pgtap")),
  };
  const operations = {
    assertClean: vi.fn(async () => {
      calls.push("clean");
      return fingerprint;
    }),
    assertResidue: vi.fn(async () => calls.push("residue")),
    cleanupResidue: vi.fn(async () => calls.push("cleanup")),
    createOwnerPassword: vi.fn(() => "SyntheticOwner9!password-password"),
    getTargets: vi.fn(async () => {
      calls.push("targets");
      return targets;
    }),
    probeDataApi: vi.fn(async () => calls.push("api")),
    provisionOwner: vi.fn(async () => calls.push("provision")),
    reconcileLedger: vi.fn(async () => calls.push("ledger")),
    runBooking: vi.fn(async () => calls.push("booking")),
    runOwnerScenario: vi.fn(async (options) => {
      calls.push("auth");
      expect(options.owner.email).toBe(GREENFIELD_TEST_OWNER.email);
      await options.reconcileLedger();
    }),
    withAuthServer: vi.fn(async (_config, _url, callback) => {
      calls.push("server");
      return callback(new URL("http://127.0.0.1:43123"));
    }),
    withRuntimeDatabase: vi.fn(async (_url, callback) => {
      calls.push("runtime-db");
      return callback({ synthetic: "runtime" });
    }),
    withRuntimeRole: vi.fn(async ({ callback }) => {
      calls.push("runtime-role");
      return callback({ runtimeDatabaseUrl: "postgresql://runtime.invalid" });
    }),
    verifyAuthConfiguration: vi.fn(async () => calls.push("auth-config")),
    ...overrides,
  };
  return { calls, cli, operations };
}

function options(cli, overrides = {}) {
  return {
    cli,
    config: { projectRef: "lxvsspniipcotimbsfqm" },
    cycle: "A",
    recoverRuntimeRole: vi.fn(async () => {}),
    worker: { synthetic: "operator" },
    ...overrides,
  };
}

describe("greenfield TEST acceptance cycle", () => {
  it("runs bounded checks, real shared scenarios, and exact cleanup in order", async () => {
    const { calls, cli, operations } = harness();
    await expect(
      runGreenfieldAcceptanceCycle(options(cli), operations),
    ).resolves.toEqual(fingerprint);

    expect(calls).toEqual([
      "clean",
      "lint",
      "advisors",
      "pgtap",
      "clean",
      "api",
      "targets",
      "provision",
      "auth-config",
      "runtime-role",
      "runtime-db",
      "booking",
      "server",
      "auth",
      "ledger",
      "residue",
      "cleanup",
      "clean",
    ]);
    expect(operations.cleanupResidue).toHaveBeenCalledWith(
      options(cli).worker,
      targets,
      GREENFIELD_TARGET_VERSIONS,
      fingerprint,
    );
  });

  it("always cleans exact fixtures when acceptance fails", async () => {
    const acceptanceFailure = new Error("synthetic booking failure");
    const { calls, cli, operations } = harness({
      runBooking: vi.fn(async () => {
        calls.push("booking-failed");
        throw acceptanceFailure;
      }),
    });

    await expect(
      runGreenfieldAcceptanceCycle(options(cli), operations),
    ).rejects.toBe(acceptanceFailure);
    expect(calls).toContain("cleanup");
    expect(calls).not.toContain("auth");
  });

  it("preserves both acceptance and cleanup failures", async () => {
    const acceptanceFailure = new Error("synthetic fixture failure");
    const cleanupFailure = new Error("synthetic cleanup failure");
    const { cli, operations } = harness({
      provisionOwner: vi.fn(async () => {
        throw acceptanceFailure;
      }),
      cleanupResidue: vi.fn(async () => {
        throw cleanupFailure;
      }),
    });

    const error = await runGreenfieldAcceptanceCycle(options(cli), operations)
      .then(() => null)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([acceptanceFailure, cleanupFailure]);
  });

  it("rejects schema drift before fixtures or between cycles", async () => {
    const changed = { ...fingerprint, schemaFingerprint: "c".repeat(64) };
    const { cli, operations } = harness({
      assertClean: vi
        .fn()
        .mockResolvedValueOnce(fingerprint)
        .mockResolvedValueOnce(changed),
    });
    await expect(
      runGreenfieldAcceptanceCycle(options(cli), operations),
    ).rejects.toThrow("database checks");
    expect(operations.provisionOwner).not.toHaveBeenCalled();

    const second = harness();
    await expect(
      runGreenfieldAcceptanceCycle(
        options(second.cli, { cycle: "B", expectedFingerprint: changed }),
        second.operations,
      ),
    ).rejects.toThrow("cycle B");
  });

  it("compares both schema and reference fingerprints", () => {
    expect(greenfieldFingerprintsMatch(fingerprint, { ...fingerprint })).toBe(
      true,
    );
    expect(
      greenfieldFingerprintsMatch(fingerprint, {
        ...fingerprint,
        referenceChecksum: "d".repeat(64),
      }),
    ).toBe(false);
  });
});
