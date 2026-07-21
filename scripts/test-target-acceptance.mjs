import {
  getBookingConcurrencyTargets,
  provisionBookingConcurrencyOwner,
  runBookingConcurrencySuite,
} from "./booking-concurrency-suite.mjs";
import { runOwnerAuthRouteScenario } from "./owner-auth-route-scenario.mjs";
import { withGreenfieldOwnerAuthServer } from "./test-target-auth-server.mjs";
import { verifyTestTargetAuthConfiguration } from "./test-target-auth-config.mjs";
import { runTestTargetDataApiProbes } from "./test-target-data-api.mjs";
import {
  GREENFIELD_TEST_OWNER,
  assertCleanGreenfield,
  assertKnownGreenfieldResidue,
  cleanupKnownGreenfieldResidue,
  provisionGreenfieldOwner,
} from "./test-target-fixtures.mjs";
import { GREENFIELD_TARGET_VERSIONS } from "./test-target-migrations.mjs";
import {
  GREENFIELD_OWNER_COOKIE_SECURITY,
  createGreenfieldOwnerPassword,
  reconcileGreenfieldOwnerLedger,
  withGreenfieldRuntimeDatabase,
} from "./test-target-runtime.mjs";
import { drainGreenfieldRuntimeSessions } from "./test-target-runtime-role.mjs";

const DEFAULT_OPERATIONS = Object.freeze({
  assertClean: assertCleanGreenfield,
  assertResidue: assertKnownGreenfieldResidue,
  cleanupResidue: cleanupKnownGreenfieldResidue,
  createOwnerPassword: createGreenfieldOwnerPassword,
  drainRuntimeSessions: drainGreenfieldRuntimeSessions,
  getTargets: getBookingConcurrencyTargets,
  probeDataApi: runTestTargetDataApiProbes,
  provisionConcurrencyOwner: provisionBookingConcurrencyOwner,
  provisionOwner: provisionGreenfieldOwner,
  reconcileLedger: reconcileGreenfieldOwnerLedger,
  runBooking: runBookingConcurrencySuite,
  runOwnerScenario: runOwnerAuthRouteScenario,
  withAuthServer: withGreenfieldOwnerAuthServer,
  withRuntimeDatabase: withGreenfieldRuntimeDatabase,
  verifyAuthConfiguration: verifyTestTargetAuthConfiguration,
});

export const GREENFIELD_REMOTE_BARRIER_WAITERS = 5;

function sameFingerprint(left, right) {
  return (
    left?.schemaFingerprint === right?.schemaFingerprint &&
    left?.referenceChecksum === right?.referenceChecksum
  );
}

function assertSameFingerprint(actual, expected, point) {
  if (!sameFingerprint(actual, expected)) {
    throw new Error(`Greenfield TEST fingerprint changed at ${point}`);
  }
}

async function runFixtureAcceptance({
  config,
  fingerprint,
  operations,
  targets,
  worker,
}) {
  let acceptanceError;
  try {
    const password = operations.createOwnerPassword();
    await operations.provisionOwner(worker, password);
    await operations.provisionConcurrencyOwner(worker);
    await operations.verifyAuthConfiguration(config);
    const runtimeDatabaseUrl = config.getRuntimeDatabaseUrl();
    await operations.withRuntimeDatabase(
      runtimeDatabaseUrl,
      (runtime) =>
        operations.runBooking(runtime, {
          barrierWaiters: GREENFIELD_REMOTE_BARRIER_WAITERS,
          reconciliationSql: worker,
          targets,
          provisionOwner: false,
        }),
      { caCertificate: config.getDatabaseCaCertificate() },
    );
    let ownerScenarioError;
    try {
      await operations.withAuthServer(config, runtimeDatabaseUrl, (baseUrl) =>
        operations.runOwnerScenario({
          baseUrl,
          owner: {
            email: GREENFIELD_TEST_OWNER.email,
            password,
          },
          cookieSecurity: GREENFIELD_OWNER_COOKIE_SECURITY,
          reconcileLedger: () => operations.reconcileLedger(worker),
        }),
      );
    } catch (error) {
      ownerScenarioError = error;
    }
    try {
      await operations.drainRuntimeSessions(worker);
    } catch (drainError) {
      if (ownerScenarioError) {
        throw new AggregateError(
          [ownerScenarioError, drainError],
          "Greenfield TEST owner scenario and runtime drain both failed",
        );
      }
      throw drainError;
    }
    if (ownerScenarioError) throw ownerScenarioError;
    await operations.assertResidue(worker, targets);
  } catch (error) {
    acceptanceError = error;
  }

  try {
    await operations.cleanupResidue(
      worker,
      targets,
      GREENFIELD_TARGET_VERSIONS,
      fingerprint,
    );
  } catch (cleanupError) {
    if (acceptanceError) {
      throw new AggregateError(
        [acceptanceError, cleanupError],
        "Greenfield TEST acceptance and cleanup both failed",
      );
    }
    throw cleanupError;
  }
  if (acceptanceError) throw acceptanceError;
}

function validatedOperations(overrides) {
  const operations = { ...DEFAULT_OPERATIONS, ...overrides };
  if (
    Object.values(operations).some(
      (operation) => typeof operation !== "function",
    )
  ) {
    throw new Error("Greenfield TEST acceptance operations are invalid");
  }
  return operations;
}

export async function runGreenfieldAcceptanceCycle(
  { cli, config, cycle, expectedFingerprint, worker },
  operationOverrides = {},
) {
  if (!new Set(["A", "B"]).has(cycle) || !cli || !worker) {
    throw new Error("Greenfield TEST acceptance cycle is invalid");
  }
  const operations = validatedOperations(operationOverrides);
  const fingerprint = await operations.assertClean(
    worker,
    GREENFIELD_TARGET_VERSIONS,
  );
  if (expectedFingerprint) {
    assertSameFingerprint(fingerprint, expectedFingerprint, `cycle ${cycle}`);
  }

  await cli.lintPrivateSchema();
  await cli.runAdvisors();
  await cli.runRemotePgTap();
  assertSameFingerprint(
    await operations.assertClean(worker, GREENFIELD_TARGET_VERSIONS),
    fingerprint,
    `cycle ${cycle} database checks`,
  );
  await operations.probeDataApi(config);

  const targets = await operations.getTargets(worker);
  await runFixtureAcceptance({
    config,
    fingerprint,
    operations,
    targets,
    worker,
  });
  assertSameFingerprint(
    await operations.assertClean(worker, GREENFIELD_TARGET_VERSIONS),
    fingerprint,
    `cycle ${cycle} cleanup`,
  );

  process.stdout.write(
    `Greenfield TEST cycle ${cycle} acceptance passed with zero residue.\n`,
  );
  return fingerprint;
}

export function greenfieldFingerprintsMatch(left, right) {
  return sameFingerprint(left, right);
}
