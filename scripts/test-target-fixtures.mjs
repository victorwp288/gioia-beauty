import {
  GREENFIELD_CONCURRENCY_OWNER,
  GREENFIELD_OWNER_PROVISION_SQL,
  GREENFIELD_RACE_COMMAND_KEYS,
  GREENFIELD_SCHEDULE_NOTES,
  GREENFIELD_STATE_SQL,
  GREENFIELD_TEST_OWNER,
  GREENFIELD_VACATION_REASON,
} from "./test-target-fixture-sql.mjs";
import { GREENFIELD_FINGERPRINT_SQL } from "./test-target-fingerprint-sql.mjs";
import {
  assertCleanGreenfieldRow,
  assertGreenfieldFingerprintRow,
  assertKnownResidueRow,
  assertOnlyKnownResidueRow,
} from "./test-target-reconciliation.mjs";
import {
  GREENFIELD_CLEANUP_ISOLATION_SQL,
  GREENFIELD_CLEANUP_SQL,
  GREENFIELD_RESIDUE_SQL,
} from "./test-target-residue-sql.mjs";

export * from "./test-target-fixture-sql.mjs";
export * from "./test-target-fingerprint-sql.mjs";
export * from "./test-target-residue-sql.mjs";
export * from "./test-target-reconciliation.mjs";

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CATALOG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function queryOne(sql, query, parameters = []) {
  const [row, ...extra] = await sql.unsafe(query, parameters);
  if (!row || extra.length !== 0) {
    throw new Error("Greenfield TEST reconciliation returned invalid rows");
  }
  return row;
}

export async function assertCleanGreenfield(sql, expectedVersions) {
  assertCleanGreenfieldRow(
    await queryOne(sql, GREENFIELD_STATE_SQL),
    expectedVersions,
  );
  return assertGreenfieldFingerprintRow(
    await queryOne(sql, GREENFIELD_FINGERPRINT_SQL),
  );
}

export async function provisionGreenfieldOwner(sql, password) {
  if (
    typeof password !== "string" ||
    password.length < 24 ||
    password.length > 128 ||
    /\s/u.test(password) ||
    !/[a-z]/u.test(password) ||
    !/[A-Z]/u.test(password) ||
    !/[0-9]/u.test(password) ||
    !/[^A-Za-z0-9]/u.test(password)
  ) {
    throw new Error("Greenfield TEST owner password is invalid");
  }
  await sql.begin(async (transaction) => {
    await transaction.unsafe(GREENFIELD_OWNER_PROVISION_SQL[0], [
      GREENFIELD_TEST_OWNER.id,
      GREENFIELD_TEST_OWNER.email,
      password,
    ]);
    await transaction.unsafe(GREENFIELD_OWNER_PROVISION_SQL[1], [
      GREENFIELD_TEST_OWNER.identityId,
      GREENFIELD_TEST_OWNER.id,
      GREENFIELD_TEST_OWNER.email,
    ]);
    await transaction.unsafe(GREENFIELD_OWNER_PROVISION_SQL[2], [
      GREENFIELD_TEST_OWNER.id,
    ]);
  });
}

function fixtureParameters(targets) {
  if (
    !Array.isArray(targets) ||
    targets.length !== 5 ||
    targets.some(
      (target) =>
        !target ||
        !LOCAL_DATE.test(target.localDate) ||
        !CATALOG_ID.test(target.serviceId) ||
        !CATALOG_ID.test(target.variantId),
    ) ||
    new Set(targets.map((target) => target.localDate)).size !== 5 ||
    targets.some(
      (target) =>
        target.serviceId !== targets[0].serviceId ||
        target.variantId !== targets[0].variantId,
    )
  ) {
    throw new Error("Greenfield TEST cleanup requires five exact targets");
  }
  const targetDates = targets.map((target) => target.localDate);
  const ownerIds = [GREENFIELD_TEST_OWNER.id, GREENFIELD_CONCURRENCY_OWNER.id];
  if (ownerIds.some((id) => !UUID.test(id))) {
    throw new Error("Greenfield TEST fixture IDs are invalid");
  }
  return [
    GREENFIELD_SCHEDULE_NOTES,
    targetDates,
    GREENFIELD_VACATION_REASON,
    GREENFIELD_RACE_COMMAND_KEYS,
    ownerIds,
    GREENFIELD_CONCURRENCY_OWNER.id,
    GREENFIELD_CONCURRENCY_OWNER.sessionId,
    GREENFIELD_TEST_OWNER.id,
    GREENFIELD_TEST_OWNER.identityId,
    GREENFIELD_TEST_OWNER.email,
    targets[0].serviceId,
    targets[0].variantId,
  ];
}

export async function assertKnownGreenfieldResidue(sql, targets) {
  return assertKnownResidueRow(
    await queryOne(sql, GREENFIELD_RESIDUE_SQL, fixtureParameters(targets)),
  );
}

export async function cleanupKnownGreenfieldResidue(
  sql,
  targets,
  expectedVersions,
  expectedFingerprint,
) {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(GREENFIELD_CLEANUP_ISOLATION_SQL);
    assertOnlyKnownResidueRow(
      await queryOne(
        transaction,
        GREENFIELD_RESIDUE_SQL,
        fixtureParameters(targets),
      ),
    );
    const owners = [GREENFIELD_TEST_OWNER.id, GREENFIELD_CONCURRENCY_OWNER.id];
    const targetDates = targets.map((target) => target.localDate);
    const parameters = [
      [GREENFIELD_TEST_OWNER.id, GREENFIELD_TEST_OWNER.email],
      [GREENFIELD_SCHEDULE_NOTES, targetDates],
      [GREENFIELD_SCHEDULE_NOTES, targetDates, GREENFIELD_VACATION_REASON],
      [GREENFIELD_RACE_COMMAND_KEYS],
      [GREENFIELD_SCHEDULE_NOTES, targetDates],
      [GREENFIELD_VACATION_REASON, targetDates[2]],
      [targetDates],
      [owners],
      [owners],
      [owners],
    ];
    for (const [index, query] of GREENFIELD_CLEANUP_SQL.entries()) {
      await transaction.unsafe(query, parameters[index]);
    }
    const fingerprint = await assertCleanGreenfield(
      transaction,
      expectedVersions,
    );
    if (
      fingerprint.schemaFingerprint !==
        expectedFingerprint?.schemaFingerprint ||
      fingerprint.referenceChecksum !== expectedFingerprint?.referenceChecksum
    ) {
      throw new Error(
        "Greenfield TEST catalog changed during fixture execution",
      );
    }
  });
}
