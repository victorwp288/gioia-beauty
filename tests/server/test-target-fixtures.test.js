import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_CLEANUP_SQL,
  GREENFIELD_CLEANUP_ISOLATION_SQL,
  GREENFIELD_EXPECTED_PRIVATE_FUNCTION_NAMES,
  GREENFIELD_EXPECTED_PRIVATE_TABLE_NAMES,
  GREENFIELD_EXPECTED_ROLE_NAMES,
  GREENFIELD_EXPECTED_SCHEMA_NAMES,
  GREENFIELD_OWNER_PROVISION_SQL,
  GREENFIELD_FINGERPRINT_SQL,
  GREENFIELD_REFERENCE_CHECKSUM,
  GREENFIELD_RESIDUE_SQL,
  GREENFIELD_STATE_SQL,
  assertCleanGreenfieldRow,
  assertGreenfieldFingerprintRow,
  assertKnownResidueRow,
  assertOnlyKnownResidueRow,
  cleanupKnownGreenfieldResidue,
  provisionGreenfieldOwner,
} from "../../scripts/test-target-fixtures.mjs";

const versions = ["20260709235538", "20260710013427"];
const dates = [
  "2099-01-04",
  "2099-01-05",
  "2099-01-06",
  "2099-01-07",
  "2099-01-08",
];
const targets = dates.map((localDate) => ({
  localDate,
  serviceId: "synthetic-service",
  variantId: "synthetic-variant",
}));
const fingerprint = {
  schemaFingerprint: "a".repeat(64),
  referenceChecksum: GREENFIELD_REFERENCE_CHECKSUM,
};

function cleanRow(overrides = {}) {
  return {
    migration_versions: versions,
    role_names: GREENFIELD_EXPECTED_ROLE_NAMES,
    schema_names: GREENFIELD_EXPECTED_SCHEMA_NAMES,
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
    ...overrides,
  };
}

function residueRow(overrides = {}) {
  return {
    commands: 27,
    distinct_command_keys: 27,
    completed_commands: 5,
    failed_commands: 22,
    distinct_completed_commands: 1,
    booking_vacation_completed_commands: 1,
    unknown_commands: 0,
    entries: 5,
    unknown_entries: 0,
    vacations: 0,
    unknown_vacations: 0,
    outbox: 10,
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
    auth_audit_rows: 3,
    unknown_auth_audit_rows: 0,
    auth_sessions: 0,
    unknown_auth_sessions: 0,
    refresh_tokens: 0,
    unknown_refresh_tokens: 0,
    auth_aux_rows: 0,
    storage_rows: 0,
    unrelated_rows: 0,
    ...overrides,
  };
}

function fingerprintRow(overrides = {}) {
  return {
    schema_fingerprint: fingerprint.schemaFingerprint,
    reference_checksum: GREENFIELD_REFERENCE_CHECKSUM,
    public_relations: 0,
    public_functions: 0,
    public_policies: 0,
    test_extensions: 0,
    auth_instances: 0,
    ...overrides,
  };
}

describe("greenfield TEST fixture reconciliation", () => {
  it("pins the complete 61-migration private catalog", () => {
    expect(GREENFIELD_EXPECTED_PRIVATE_TABLE_NAMES).toHaveLength(32);
    expect(GREENFIELD_EXPECTED_PRIVATE_FUNCTION_NAMES).toHaveLength(86);
    expect(GREENFIELD_EXPECTED_PRIVATE_TABLE_NAMES).toContain(
      "email_dead_letter_monitor_state",
    );
    expect(GREENFIELD_EXPECTED_PRIVATE_FUNCTION_NAMES).toContain(
      "authorize_cutover_write",
    );
  });

  it("binds every operator fixture parameter to an explicit PostgreSQL type", () => {
    expect(GREENFIELD_OWNER_PROVISION_SQL[0]).toContain(
      "extensions.crypt($3::text",
    );
    expect(GREENFIELD_OWNER_PROVISION_SQL[1]).toContain("'email',$3::text");
    expect(GREENFIELD_RESIDUE_SQL).toContain("($1::text[])[1]");
    expect(GREENFIELD_RESIDUE_SQL).toContain("($1::text[])[5]");
  });

  it("accepts only the exact clean schema and migration history", () => {
    expect(assertCleanGreenfieldRow(cleanRow(), versions)).toBe(true);
    expect(() =>
      assertCleanGreenfieldRow(cleanRow({ tables: 17 }), versions),
    ).toThrow("baseline does not reconcile");
    expect(() =>
      assertCleanGreenfieldRow(cleanRow(), [...versions].reverse()),
    ).toThrow("migration history is not exact");
    expect(() =>
      assertCleanGreenfieldRow(
        cleanRow({ role_names: ["postgres"] }),
        versions,
      ),
    ).toThrow("managed catalog is not exact");
  });

  it("pins reference content and rejects public or catalog drift", () => {
    expect(assertGreenfieldFingerprintRow(fingerprintRow())).toEqual(
      fingerprint,
    );
    expect(() =>
      assertGreenfieldFingerprintRow(fingerprintRow({ public_functions: 1 })),
    ).toThrow("catalog fingerprint does not reconcile");
    expect(() =>
      assertGreenfieldFingerprintRow(fingerprintRow({ test_extensions: 1 })),
    ).toThrow("catalog fingerprint does not reconcile");
    expect(() =>
      assertGreenfieldFingerprintRow(
        fingerprintRow({ reference_checksum: "b".repeat(64) }),
      ),
    ).toThrow("catalog fingerprint does not reconcile");
  });

  it("accepts both one-winner booking-vacation residue shapes", () => {
    expect(assertKnownResidueRow(residueRow())).toEqual({
      entries: 5,
      vacations: 0,
      outbox: 10,
    });
    expect(
      assertKnownResidueRow(
        residueRow({ entries: 4, vacations: 1, outbox: 8 }),
      ),
    ).toEqual({ entries: 4, vacations: 1, outbox: 8 });
  });

  it.each([
    { unknown_commands: 1 },
    { distinct_command_keys: 26 },
    { completed_commands: 4, failed_commands: 23 },
    { unknown_entries: 1 },
    { unknown_auth_users: 1 },
    { unknown_auth_sessions: 1 },
    { unknown_refresh_tokens: 1 },
    { unknown_auth_audit_rows: 1 },
    { unrelated_rows: 1 },
    { commands: 26 },
    { owner_sessions: 3 },
  ])("rejects unknown or incomplete residue %#", (override) => {
    expect(() => assertKnownResidueRow(residueRow(override))).toThrow(
      "unknown or incomplete residue",
    );
  });

  it("permits bounded partial residue for guarded recovery", () => {
    expect(
      assertOnlyKnownResidueRow(
        residueRow({
          commands: 3,
          distinct_command_keys: 3,
          completed_commands: 1,
          failed_commands: 2,
          distinct_completed_commands: 1,
          booking_vacation_completed_commands: 0,
          entries: 1,
          outbox: 2,
          changes: 1,
          distinct_change_aggregates: 1,
          locks: 2,
          owners: 1,
          owner_sessions: 1,
          concurrency_session: 0,
          revoked_route_session: 0,
          auth_users: 1,
          auth_sessions: 1,
          refresh_tokens: 1,
        }),
      ),
    ).toEqual({ commands: 3, entries: 1, vacations: 0, outbox: 2 });
  });

  it("permits an exact no-op cleanup after a pre-fixture failure", () => {
    expect(
      assertOnlyKnownResidueRow(
        residueRow({
          commands: 0,
          distinct_command_keys: 0,
          completed_commands: 0,
          failed_commands: 0,
          distinct_completed_commands: 0,
          booking_vacation_completed_commands: 0,
          entries: 0,
          outbox: 0,
          changes: 0,
          distinct_change_aggregates: 0,
          locks: 0,
          owners: 0,
          owner_sessions: 0,
          concurrency_session: 0,
          revoked_route_session: 0,
          auth_users: 0,
          identities: 0,
          auth_audit_rows: 0,
        }),
      ),
    ).toEqual({ commands: 0, entries: 0, vacations: 0, outbox: 0 });
  });

  it("refuses partial cleanup when any row exceeds fixture bounds", () => {
    expect(() =>
      assertOnlyKnownResidueRow(residueRow({ commands: 28 })),
    ).toThrow("unknown or excessive residue");
    expect(() =>
      assertOnlyKnownResidueRow(residueRow({ auth_sessions: 2 })),
    ).toThrow("unknown or excessive residue");
    expect(() =>
      assertOnlyKnownResidueRow(residueRow({ auth_audit_rows: 21 })),
    ).toThrow("unknown or excessive residue");
  });
});

describe("greenfield TEST fixture mutation safety", () => {
  it("binds the ephemeral owner password inside one transaction", async () => {
    const unsafe = vi.fn(async () => []);
    const sql = { begin: (callback) => callback({ unsafe }) };
    const password = "RandomOwner9!" + "x".repeat(24);

    await provisionGreenfieldOwner(sql, password);

    expect(unsafe).toHaveBeenCalledTimes(3);
    expect(unsafe.mock.calls[0][0]).toBe(GREENFIELD_OWNER_PROVISION_SQL[0]);
    expect(unsafe.mock.calls[0][0]).not.toContain(password);
    expect(unsafe.mock.calls[0][1][2]).toBe(password);
  });

  it.each(["short", ` ${"A9!x".repeat(8)}`, "x".repeat(129)])(
    "rejects unsafe password input without echoing it",
    async (password) => {
      await expect(
        provisionGreenfieldOwner({ begin: vi.fn() }, password),
      ).rejects.toThrow("owner password is invalid");
    },
  );

  it("guards before cleanup, deletes in dependency order, and reconciles", async () => {
    const unsafe = vi.fn(async (query) => {
      if (query === GREENFIELD_RESIDUE_SQL) return [residueRow()];
      if (query === GREENFIELD_STATE_SQL) return [cleanRow()];
      if (query === GREENFIELD_FINGERPRINT_SQL) return [fingerprintRow()];
      return [];
    });
    const begin = vi.fn((callback) => callback({ unsafe }));

    await cleanupKnownGreenfieldResidue(
      { begin },
      targets,
      versions,
      fingerprint,
    );

    expect(begin).toHaveBeenCalledOnce();
    expect(unsafe.mock.calls[0][0]).toBe(GREENFIELD_CLEANUP_ISOLATION_SQL);
    expect(unsafe.mock.calls[1][0]).toBe(GREENFIELD_RESIDUE_SQL);
    expect(unsafe.mock.calls.slice(2, -2).map(([query]) => query)).toEqual(
      GREENFIELD_CLEANUP_SQL,
    );
    expect(unsafe.mock.calls.at(-2)[0]).toBe(GREENFIELD_STATE_SQL);
    expect(unsafe.mock.calls.at(-1)[0]).toBe(GREENFIELD_FINGERPRINT_SQL);
    const deletionCalls = unsafe.mock.calls.slice(2, -2);
    expect(deletionCalls[1][1][1]).toEqual(dates);
    expect(deletionCalls[2][1][1]).toEqual(dates);
    expect(deletionCalls[4][1][1]).toEqual(dates);
    expect(deletionCalls[5][1]).toEqual([
      "Synthetic booking vacation race",
      dates[2],
    ]);
  });

  it("rejects ambiguous dates before running any cleanup statement", async () => {
    const unsafe = vi.fn();
    const begin = vi.fn((callback) => callback({ unsafe }));
    await expect(
      cleanupKnownGreenfieldResidue(
        { begin },
        [targets[0], targets[0], ...targets.slice(2)],
        versions,
        fingerprint,
      ),
    ).rejects.toThrow("five exact targets");
    expect(begin).toHaveBeenCalledOnce();
    expect(unsafe).toHaveBeenCalledOnce();
    expect(unsafe).toHaveBeenCalledWith(GREENFIELD_CLEANUP_ISOLATION_SQL);
  });

  it("contains no broad or migration-history destructive SQL", () => {
    const cleanup = GREENFIELD_CLEANUP_SQL.join("\n").toLowerCase();
    expect(cleanup).not.toMatch(/\btruncate\b|\bcascade\b|drop\s+/u);
    expect(cleanup).not.toContain("supabase_migrations");
    expect(cleanup).not.toMatch(/delete\s+from\s+auth\.users\s*$/mu);
    expect(cleanup).toContain("where id = any($1::uuid[])");
    expect(cleanup).toContain("local_date = any($2::date[])");
    expect(GREENFIELD_RESIDUE_SQL).toContain("payload is null");
    expect(GREENFIELD_RESIDUE_SQL).toContain("($2::date[])[5]");
    expect(GREENFIELD_RESIDUE_SQL).toContain("entry.service_id = $11");
  });
});
