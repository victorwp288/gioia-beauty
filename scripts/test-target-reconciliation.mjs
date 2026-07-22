import {
  GREENFIELD_EXPECTED_ROLE_NAMES,
  GREENFIELD_EXPECTED_SCHEMA_NAMES,
} from "./test-target-fixture-sql.mjs";
import {
  GREENFIELD_REFERENCE_CHECKSUM,
  GREENFIELD_SCHEMA_FINGERPRINT,
} from "./test-target-fingerprint-sql.mjs";

function integer(row, field) {
  const value = Number(row?.[field]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Greenfield TEST reconciliation returned invalid counts");
  }
  return value;
}

export function assertCleanGreenfieldRow(row, expectedVersions) {
  const actualVersions = row?.migration_versions;
  if (
    !Array.isArray(actualVersions) ||
    actualVersions.join("|") !== expectedVersions.join("|")
  ) {
    throw new Error("Greenfield TEST migration history is not exact");
  }
  for (const [field, expected] of [
    ["role_names", GREENFIELD_EXPECTED_ROLE_NAMES],
    ["schema_names", GREENFIELD_EXPECTED_SCHEMA_NAMES],
  ]) {
    const actual = row?.[field];
    if (!Array.isArray(actual) || actual.join("|") !== expected.join("|")) {
      throw new Error("Greenfield TEST managed catalog is not exact");
    }
  }
  const expected = {
    tables: 32,
    forced_rls: 32,
    functions: 86,
    roles: 3,
    unsafe_role_credentials: 0,
    unsafe_roles: 0,
    unsafe_role_memberships: 0,
    public_tables: 0,
    categories: 12,
    services: 74,
    variants: 102,
    hours: 5,
    policies: 1,
    abuse_policies: 9,
    cutover_controls: 1,
    dead_letter_monitor_states: 1,
    auth_users: 0,
    auth_identities: 0,
    auth_sessions: 0,
    refresh_tokens: 0,
    auth_audit_rows: 0,
    auth_aux_rows: 0,
    storage_rows: 0,
    owners: 0,
    owner_sessions: 0,
    operational_rows: 0,
  };
  if (
    Object.entries(expected).some(
      ([field, value]) => integer(row, field) !== value,
    )
  ) {
    throw new Error("Greenfield TEST baseline does not reconcile");
  }
  return true;
}

export function assertGreenfieldFingerprintRow(row) {
  const schemaFingerprint = String(row?.schema_fingerprint ?? "");
  const referenceChecksum = String(row?.reference_checksum ?? "");
  if (
    schemaFingerprint !== GREENFIELD_SCHEMA_FINGERPRINT ||
    referenceChecksum !== GREENFIELD_REFERENCE_CHECKSUM ||
    integer(row, "public_relations") !== 0 ||
    integer(row, "public_functions") !== 0 ||
    integer(row, "public_policies") !== 0 ||
    integer(row, "test_extensions") !== 0 ||
    integer(row, "auth_instances") !== 0
  ) {
    throw new Error("Greenfield TEST catalog fingerprint does not reconcile");
  }
  return Object.freeze({ schemaFingerprint, referenceChecksum });
}

export function assertKnownResidueRow(row) {
  const entries = integer(row, "entries");
  const vacations = integer(row, "vacations");
  const expected = {
    commands: 27,
    distinct_command_keys: 27,
    completed_commands: 5,
    failed_commands: 22,
    distinct_completed_commands: 1,
    booking_vacation_completed_commands: 1,
    unknown_commands: 0,
    unknown_entries: 0,
    unknown_vacations: 0,
    unknown_outbox: 0,
    changes: 5,
    distinct_change_aggregates: 5,
    unknown_changes: 0,
    locks: 5,
    unknown_locks: 0,
    owners: 2,
    unknown_owners: 0,
    owner_sessions: 2,
    unknown_owner_sessions: 0,
    concurrency_session: 1,
    revoked_route_session: 1,
    auth_users: 2,
    unknown_auth_users: 0,
    identities: 1,
    unknown_identities: 0,
    unknown_auth_audit_rows: 0,
    abuse_buckets: 2,
    owner_login_network_buckets: 1,
    owner_login_account_buckets: 1,
    unknown_abuse_buckets: 0,
    auth_sessions: 0,
    unknown_auth_sessions: 0,
    refresh_tokens: 0,
    unknown_refresh_tokens: 0,
    auth_aux_rows: 0,
    known_mfa_amr_claims: 0,
    unknown_auth_aux_rows: 0,
    storage_rows: 0,
    unrelated_rows: 0,
  };
  if (
    ![4, 5].includes(entries) ||
    ![0, 1].includes(vacations) ||
    integer(row, "auth_audit_rows") > 20 ||
    entries + vacations !== 5 ||
    integer(row, "outbox") !== entries * 2 ||
    Object.entries(expected).some(
      ([field, value]) => integer(row, field) !== value,
    )
  ) {
    throw new Error("Greenfield TEST contains unknown or incomplete residue");
  }
  return { entries, vacations, outbox: entries * 2 };
}

export function assertOnlyKnownResidueRow(row) {
  const commands = integer(row, "commands");
  const entries = integer(row, "entries");
  const vacations = integer(row, "vacations");
  const outbox = integer(row, "outbox");
  const completedCommands = integer(row, "completed_commands");
  const failedCommands = integer(row, "failed_commands");
  const zeroFields = [
    "unknown_commands",
    "unknown_entries",
    "unknown_vacations",
    "unknown_outbox",
    "unknown_changes",
    "unknown_locks",
    "unknown_owners",
    "unknown_owner_sessions",
    "unknown_auth_users",
    "unknown_identities",
    "unknown_auth_sessions",
    "unknown_refresh_tokens",
    "unknown_auth_audit_rows",
    "unknown_abuse_buckets",
    "unknown_auth_aux_rows",
    "storage_rows",
    "unrelated_rows",
  ];
  const changes = integer(row, "changes");
  const bounded =
    commands <= 27 &&
    integer(row, "distinct_command_keys") === commands &&
    completedCommands <= 5 &&
    failedCommands <= 22 &&
    integer(row, "distinct_completed_commands") <= 1 &&
    integer(row, "booking_vacation_completed_commands") <= 1 &&
    completedCommands + failedCommands === commands &&
    entries <= 5 &&
    vacations <= 1 &&
    entries + vacations <= 5 &&
    outbox <= entries * 2 &&
    changes <= 5 &&
    integer(row, "distinct_change_aggregates") === changes &&
    integer(row, "locks") <= 5 &&
    integer(row, "owners") <= 2 &&
    integer(row, "owner_sessions") <= 2 &&
    integer(row, "concurrency_session") <= 1 &&
    integer(row, "revoked_route_session") <= 1 &&
    integer(row, "auth_users") <= 2 &&
    integer(row, "identities") <= 1 &&
    integer(row, "auth_sessions") <= 1 &&
    integer(row, "refresh_tokens") <= 1 &&
    integer(row, "auth_audit_rows") <= 20 &&
    integer(row, "auth_aux_rows") <= 1 &&
    integer(row, "known_mfa_amr_claims") === integer(row, "auth_aux_rows");
  const abuseBuckets = integer(row, "abuse_buckets");
  const ownerLoginNetworkBuckets = integer(row, "owner_login_network_buckets");
  const ownerLoginAccountBuckets = integer(row, "owner_login_account_buckets");
  const boundedAbuseResidue =
    abuseBuckets <= 2 &&
    ownerLoginNetworkBuckets <= 1 &&
    ownerLoginAccountBuckets <= 1 &&
    abuseBuckets === ownerLoginNetworkBuckets + ownerLoginAccountBuckets;
  if (
    !bounded ||
    !boundedAbuseResidue ||
    zeroFields.some((field) => integer(row, field) !== 0)
  ) {
    throw new Error("Greenfield TEST contains unknown or excessive residue");
  }
  return { commands, entries, vacations, outbox };
}
