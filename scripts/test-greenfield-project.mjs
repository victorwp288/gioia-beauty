import { fileURLToPath } from "node:url";

import {
  greenfieldFingerprintsMatch,
  runGreenfieldAcceptanceCycle,
} from "./test-target-acceptance.mjs";
import {
  planGreenfieldAtomicRebuild,
  rebuildGreenfieldTestAtomically,
} from "./test-target-atomic-rebuild.mjs";
import { createTestTargetCli } from "./test-target-cli.mjs";
import { parseTestTargetConfig } from "./test-target-config.mjs";
import { withGreenfieldTestLock } from "./test-target-harness.mjs";
import {
  GREENFIELD_TARGET_VERSIONS,
  repositoryMigrationFiles,
} from "./test-target-migrations.mjs";
import { verifyGreenfieldTestPreflight } from "./test-target-preflight.mjs";

const DEFAULT_OPERATIONS = Object.freeze({
  createCli: createTestTargetCli,
  createPlan: planGreenfieldAtomicRebuild,
  parseConfig: parseTestTargetConfig,
  rebuild: rebuildGreenfieldTestAtomically,
  repositoryMigrations: repositoryMigrationFiles,
  runAcceptance: runGreenfieldAcceptanceCycle,
  verifyPreflight: verifyGreenfieldTestPreflight,
  withLock: withGreenfieldTestLock,
});

function validatedOperations(overrides) {
  const operations = { ...DEFAULT_OPERATIONS, ...overrides };
  if (
    Object.values(operations).some(
      (operation) => typeof operation !== "function",
    )
  ) {
    throw new Error("Greenfield TEST operator operations are invalid");
  }
  return operations;
}

async function rebuildAndApply(worker, plan, rebuild) {
  const result = await rebuild(worker, plan);
  if (Number(result?.removedMigrations) !== GREENFIELD_TARGET_VERSIONS.length) {
    throw new Error("Greenfield TEST rebuild result is invalid");
  }
  return result;
}

function samePreflight(actual, expected) {
  return (
    actual?.ciRunId === expected.ciRunId &&
    actual?.commitSha === expected.commitSha
  );
}

async function reverifyRepository(
  operations,
  env,
  rootDirectory,
  expectedPreflight,
) {
  const actual = await operations.verifyPreflight(env, { rootDirectory });
  operations.repositoryMigrations(rootDirectory);
  if (!samePreflight(actual, expectedPreflight)) {
    throw new Error("Greenfield TEST preflight evidence changed");
  }
}

async function withFinalRuntimeRecovery(recoverRuntimeRole, callback) {
  let operationError;
  let result;
  try {
    result = await callback();
  } catch (error) {
    operationError = error;
  }
  try {
    await recoverRuntimeRole();
  } catch (recoveryError) {
    if (operationError) {
      throw new AggregateError(
        [operationError, recoveryError],
        "Greenfield TEST operation and final runtime recovery both failed",
      );
    }
    throw recoveryError;
  }
  if (operationError) throw operationError;
  return result;
}

export async function runGreenfieldTestProject(
  env,
  { operationOverrides = {}, rootDirectory = process.cwd() } = {},
) {
  const operations = validatedOperations(operationOverrides);
  const config = operations.parseConfig(env, { rootDirectory });
  const preflight = await operations.verifyPreflight(env, { rootDirectory });
  operations.repositoryMigrations(rootDirectory);
  const plan = operations.createPlan(rootDirectory);
  const cli = operations.createCli({
    getDatabaseCaCertificate: config.getDatabaseCaCertificate,
    getOperatorSessionDatabaseUrl: config.getOperatorSessionDatabaseUrl,
    rootDirectory,
  });

  return operations.withLock(config, async ({ recoverRuntimeRole, worker }) =>
    withFinalRuntimeRecovery(recoverRuntimeRole, async () => {
      const removedMigrations = [];
      await reverifyRepository(operations, env, rootDirectory, preflight);
      await cli.verifyVersion();
      await cli.lintPrivateSchema();
      await recoverRuntimeRole();
      const firstRebuild = await rebuildAndApply(
        worker,
        plan,
        operations.rebuild,
      );
      removedMigrations.push(Number(firstRebuild.removedMigrations));
      const firstFingerprint = await operations.runAcceptance({
        cli,
        config,
        cycle: "A",
        recoverRuntimeRole,
        worker,
      });
      if (!greenfieldFingerprintsMatch(firstRebuild, firstFingerprint)) {
        throw new Error("Greenfield TEST cycle A fingerprint is unstable");
      }

      await reverifyRepository(operations, env, rootDirectory, preflight);
      await cli.verifyVersion();
      await cli.lintPrivateSchema();
      await recoverRuntimeRole();
      const secondRebuild = await rebuildAndApply(
        worker,
        plan,
        operations.rebuild,
      );
      removedMigrations.push(Number(secondRebuild.removedMigrations));
      const secondFingerprint = await operations.runAcceptance({
        cli,
        config,
        cycle: "B",
        expectedFingerprint: firstFingerprint,
        recoverRuntimeRole,
        worker,
      });
      if (
        !greenfieldFingerprintsMatch(secondRebuild, secondFingerprint) ||
        !greenfieldFingerprintsMatch(firstFingerprint, secondFingerprint)
      ) {
        throw new Error("Greenfield TEST rebuild fingerprints do not match");
      }
      await reverifyRepository(operations, env, rootDirectory, preflight);

      return Object.freeze({
        cycles: 2,
        ciRunId: preflight.ciRunId,
        commitSha: preflight.commitSha,
        projectRef: config.projectRef,
        removedMigrations: Object.freeze(removedMigrations),
        referenceChecksum: secondFingerprint.referenceChecksum,
        schemaFingerprint: secondFingerprint.schemaFingerprint,
      });
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runGreenfieldTestProject(process.env);
    process.stdout.write(
      `Greenfield TEST two-cycle rebuild passed: ${JSON.stringify(result)}\n`,
    );
  } catch {
    process.stderr.write("Greenfield TEST operator failed safely.\n");
    process.exitCode = 1;
  }
}
