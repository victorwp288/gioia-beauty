import { describe, expect, it, vi } from "vitest";

import { runGreenfieldTestProject } from "../../scripts/test-greenfield-project.mjs";
import { GREENFIELD_TARGET_VERSIONS } from "../../scripts/test-target-migrations.mjs";

const fingerprint = {
  referenceChecksum: "a".repeat(64),
  schemaFingerprint: "b".repeat(64),
};

function harness(overrides = {}) {
  const calls = [];
  const worker = { synthetic: "operator-worker" };
  const recoverRuntimeRole = vi.fn(async () => calls.push("recover"));
  const cli = {
    lintPrivateSchema: vi.fn(async () => calls.push("lint")),
    verifyVersion: vi.fn(async () => calls.push("version")),
  };
  const config = {
    getDatabaseCaCertificate: vi.fn(() => "synthetic-ca"),
    getOperatorSessionDatabaseUrl: vi.fn(() => "private-operator-url"),
    projectRef: "lxvsspniipcotimbsfqm",
  };
  let rebuildIndex = 0;
  const targetCount = GREENFIELD_TARGET_VERSIONS.length;
  const operationOverrides = {
    createCli: vi.fn(() => cli),
    createPlan: vi.fn(() => {
      calls.push("plan");
      return { synthetic: "atomic-plan" };
    }),
    parseConfig: vi.fn(() => config),
    rebuild: vi.fn(async () => {
      calls.push("rebuild");
      return {
        removedMigrations: [targetCount, targetCount][rebuildIndex++],
        ...fingerprint,
      };
    }),
    repositoryMigrations: vi.fn(() => calls.push("manifest")),
    runAcceptance: vi.fn(async ({ cycle }) => {
      calls.push(`accept-${cycle}`);
      return fingerprint;
    }),
    verifyPreflight: vi.fn(async () => {
      calls.push("preflight");
      return { ciRunId: "29068500383", commitSha: "c".repeat(40) };
    }),
    withLock: vi.fn(async (_config, callback) => {
      calls.push("lock");
      return callback({ recoverRuntimeRole, worker });
    }),
    ...overrides,
  };
  return {
    calls,
    cli,
    config,
    operationOverrides,
    recoverRuntimeRole,
    worker,
  };
}

describe("greenfield TEST two-cycle operator", () => {
  it("binds exact preflight, two rebuilds, and both acceptances under one lock", async () => {
    const state = harness();
    const result = await runGreenfieldTestProject(
      { synthetic: "operator-environment" },
      {
        rootDirectory: "/synthetic/repository",
        operationOverrides: state.operationOverrides,
      },
    );

    expect(state.calls).toEqual([
      "preflight",
      "manifest",
      "plan",
      "lock",
      "preflight",
      "manifest",
      "version",
      "lint",
      "recover",
      "rebuild",
      "accept-A",
      "preflight",
      "manifest",
      "version",
      "lint",
      "recover",
      "rebuild",
      "accept-B",
      "preflight",
      "manifest",
      "recover",
    ]);
    expect(result).toEqual({
      cycles: 2,
      ciRunId: "29068500383",
      commitSha: "c".repeat(40),
      projectRef: "lxvsspniipcotimbsfqm",
      removedMigrations: [
        GREENFIELD_TARGET_VERSIONS.length,
        GREENFIELD_TARGET_VERSIONS.length,
      ],
      ...fingerprint,
    });
    expect(state.operationOverrides.createCli).toHaveBeenCalledWith({
      getDatabaseCaCertificate: state.config.getDatabaseCaCertificate,
      getOperatorSessionDatabaseUrl: state.config.getOperatorSessionDatabaseUrl,
      rootDirectory: "/synthetic/repository",
    });
    expect(
      state.operationOverrides.runAcceptance.mock.calls[1][0],
    ).toMatchObject({
      cycle: "B",
      expectedFingerprint: fingerprint,
      worker: state.worker,
    });
  });

  it.each([35, 37, GREENFIELD_TARGET_VERSIONS.length - 1])(
    "rejects atomic result with unsupported migration count %i",
    async (removedMigrations) => {
      const state = harness({
        rebuild: vi.fn(async () => ({ removedMigrations })),
      });
      await expect(
        runGreenfieldTestProject(
          {},
          {
            operationOverrides: state.operationOverrides,
          },
        ),
      ).rejects.toThrow("rebuild result is invalid");
      expect(state.cli.lintPrivateSchema).toHaveBeenCalledOnce();
      expect(state.operationOverrides.runAcceptance).not.toHaveBeenCalled();
    },
  );

  it("does not start acceptance after an atomic rebuild failure", async () => {
    const rebuildFailure = new Error("synthetic atomic failure");
    const state = harness();
    state.operationOverrides.rebuild.mockRejectedValueOnce(rebuildFailure);

    await expect(
      runGreenfieldTestProject(
        {},
        {
          operationOverrides: state.operationOverrides,
        },
      ),
    ).rejects.toBe(rebuildFailure);
    expect(state.operationOverrides.runAcceptance).not.toHaveBeenCalled();
    expect(state.recoverRuntimeRole).toHaveBeenCalledTimes(2);
    expect(state.operationOverrides.withLock).toHaveBeenCalledOnce();
  });

  it("rejects different cycle fingerprints", async () => {
    const state = harness({
      runAcceptance: vi
        .fn()
        .mockResolvedValueOnce(fingerprint)
        .mockResolvedValueOnce({
          ...fingerprint,
          schemaFingerprint: "d".repeat(64),
        }),
    });
    await expect(
      runGreenfieldTestProject(
        {},
        {
          operationOverrides: state.operationOverrides,
        },
      ),
    ).rejects.toThrow("fingerprints do not match");
  });

  it("rejects checkout or CI evidence drift before reporting success", async () => {
    const stable = { ciRunId: "29068500383", commitSha: "c".repeat(40) };
    const state = harness({
      verifyPreflight: vi
        .fn()
        .mockResolvedValueOnce(stable)
        .mockResolvedValueOnce(stable)
        .mockResolvedValueOnce(stable)
        .mockResolvedValueOnce({ ...stable, commitSha: "d".repeat(40) }),
    });
    await expect(
      runGreenfieldTestProject(
        {},
        { operationOverrides: state.operationOverrides },
      ),
    ).rejects.toThrow("preflight evidence changed");
    expect(state.recoverRuntimeRole).toHaveBeenCalledTimes(3);
  });

  it("preserves an operation failure and a final recovery failure", async () => {
    const operationFailure = new Error("synthetic atomic failure");
    const recoveryFailure = new Error("synthetic recovery failure");
    const state = harness();
    state.operationOverrides.rebuild.mockRejectedValueOnce(operationFailure);
    state.recoverRuntimeRole
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(recoveryFailure);

    const error = await runGreenfieldTestProject(
      {},
      { operationOverrides: state.operationOverrides },
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([operationFailure, recoveryFailure]);
  });
});
