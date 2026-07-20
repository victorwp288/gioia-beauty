import postgres from "postgres";

import { createLocalCutoverOperator } from "./local-cutover-maintenance-operator.mjs";
import { getLocalRouteStatus } from "./local-owner-auth-harness.mjs";
import { withLocalPostgresLogicalClone } from "./local-postgres-clone.mjs";
import {
  assertLocalPostgresRecoveryMatch,
  LOCAL_POSTGRES_RECOVERY_EVIDENCE_SQL,
  parseLocalPostgresRecoveryEvidence,
  parseLocalPostgresRecoveryPsql,
} from "./local-postgres-recovery-evidence.mjs";
import { GREENFIELD_FINGERPRINT_SQL } from "./test-target-fingerprint-sql.mjs";
import { assertGreenfieldFingerprintRow } from "./test-target-reconciliation.mjs";

function oneRow(rows, code) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0])
    throw new Error(code);
  return rows[0];
}

function parsePsqlRow(stdout, code) {
  const lines = String(stdout).trim().split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error(code);
  try {
    return JSON.parse(lines[0]);
  } catch {
    throw new Error(code);
  }
}

function cutoverDatabase(database) {
  return {
    unsafe: (query, parameters) =>
      database.begin(async (transaction) => {
        await transaction.unsafe("set local role gioia_mutator");
        return [...(await transaction.unsafe(query, parameters))];
      }),
  };
}

async function sourceEvidence(database) {
  const row = oneRow(
    await database.unsafe(LOCAL_POSTGRES_RECOVERY_EVIDENCE_SQL),
    "LOCAL_RECOVERY_SOURCE_EVIDENCE_INVALID",
  );
  return parseLocalPostgresRecoveryEvidence(row.evidence);
}

async function cloneEvidence(query) {
  return parseLocalPostgresRecoveryPsql(
    await query(
      `select evidence::text from (${LOCAL_POSTGRES_RECOVERY_EVIDENCE_SQL}) recovery`,
    ),
  );
}

async function run() {
  const status = await getLocalRouteStatus();
  const adminUrl = new URL(status.databaseUrl);
  adminUrl.username = "supabase_admin";
  const admin = postgres(adminUrl.href, { max: 1, prepare: false });
  const database = postgres(status.databaseUrl, { max: 1, prepare: false });
  const operator = createLocalCutoverOperator({
    database: cutoverDatabase(database),
    env: {
      ...process.env,
      APP_ENV: "test",
      SUPABASE_DATABASE_URL: status.databaseUrl,
    },
  });
  let freeze;
  let roleGranted = false;
  let cleanupError;
  try {
    await admin.unsafe(
      "grant gioia_mutator to postgres with inherit false, set true granted by current_user",
    );
    roleGranted = true;
    freeze = await operator.freeze("PHASE5_LOCAL_RECOVERY_DRILL");
    const fingerprint = assertGreenfieldFingerprintRow(
      oneRow(
        await database.unsafe(GREENFIELD_FINGERPRINT_SQL),
        "LOCAL_RECOVERY_FINGERPRINT_INVALID",
      ),
    );
    const source = await sourceEvidence(database);
    if (source.tables.newsletter_subscribers.count < 1) {
      throw new Error("LOCAL_RECOVERY_SYNTHETIC_FIXTURE_REQUIRED");
    }
    const clone = await withLocalPostgresLogicalClone(
      async ({ dump, query, recreate }) => {
        const cloneFingerprint = assertGreenfieldFingerprintRow(
          parsePsqlRow(
            await query(
              `select row_to_json(fingerprint)::text from (${GREENFIELD_FINGERPRINT_SQL}) fingerprint`,
            ),
            "LOCAL_RECOVERY_CLONE_FINGERPRINT_INVALID",
          ),
        );
        if (JSON.stringify(fingerprint) !== JSON.stringify(cloneFingerprint)) {
          throw new Error("LOCAL_RECOVERY_FINGERPRINT_MISMATCH");
        }
        const restored = await cloneEvidence(query);
        assertLocalPostgresRecoveryMatch(source, restored);

        await query(`delete from gioia_private.newsletter_subscribers
        where id = (select id from gioia_private.newsletter_subscribers order by id limit 1)`);
        const corrupted = await cloneEvidence(query);
        if (JSON.stringify(source) === JSON.stringify(corrupted)) {
          throw new Error("LOCAL_RECOVERY_CORRUPTION_NOT_DETECTED");
        }

        await recreate();
        const recovered = await cloneEvidence(query);
        assertLocalPostgresRecoveryMatch(source, recovered);
        return Object.freeze({
          dump,
          migrations: recovered.migrations.count,
          records: recovered.tables.migration_records.count,
          scheduleEntries: recovered.tables.schedule_entries.count,
          subscribers: recovered.tables.newsletter_subscribers.count,
        });
      },
    );
    process.stdout.write(
      `${JSON.stringify({
        label: "LOCAL",
        target: "loopback Supabase PostgreSQL scratch clone",
        productionActions: "none",
        recovery: "same archive recreated after detected clone-only corruption",
        ...clone.value,
      })}\n`,
    );
  } finally {
    if (freeze) {
      try {
        const reconcileVersion = await operator.enterOwnerReconcile({
          freezeId: freeze.freezeId,
          expectedVersion: freeze.version,
          reasonCode: "PHASE5_LOCAL_RECOVERY_RECONCILE",
        });
        await operator.unfreeze({
          freezeId: freeze.freezeId,
          expectedVersion: reconcileVersion,
          reasonCode: "PHASE5_LOCAL_RECOVERY_COMPLETE",
        });
      } catch (error) {
        cleanupError = error;
      }
    }
    if (roleGranted) {
      try {
        await admin.unsafe(
          "revoke gioia_mutator from postgres granted by current_user",
        );
      } catch (error) {
        cleanupError ??= error;
      }
    }
    await database.end({ timeout: 2 });
    await admin.end({ timeout: 2 });
    if (cleanupError) throw cleanupError;
  }
}

await run();
