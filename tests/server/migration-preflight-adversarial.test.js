import { describe, expect, it } from "vitest";

import {
  PROTECTED_OPERATOR_ENV_KEYS,
  isProtectedOperatorEnvironmentKey,
} from "@/config/operatorEnvironmentPolicy.mjs";
import {
  MigrationArgumentError,
  evaluateMigrationPreflight,
  parseMigrationArguments,
} from "@/lib/server/migrationPreflight.mjs";

import {
  OPERATOR_ENVIRONMENT,
  VALID_IMPORT_OPTIONS,
  VALID_INVENTORY_OPTIONS,
  VALID_RECONCILE_OPTIONS,
  applyOptions,
} from "./migration-preflight-fixture.js";

function argumentError(argv) {
  try {
    parseMigrationArguments(argv);
  } catch (error) {
    return error;
  }
  return null;
}

describe("migration preflight hostile boundaries", () => {
  it.each([
    [["--unknown-private-sentinel", "value"], "UNKNOWN_FLAG", null],
    [["positional-private-sentinel"], "UNEXPECTED_ARGUMENT", null],
    [["--action"], "MISSING_FLAG_VALUE", "action"],
    [["--action", "--apply"], "MISSING_FLAG_VALUE", "action"],
    [["--apply", "--apply"], "DUPLICATE_FLAG", "apply"],
    [["--action", "import", "--action", "import"], "DUPLICATE_FLAG", "action"],
    [["--action=import"], "UNKNOWN_FLAG", null],
    [["--ACTION", "import"], "UNKNOWN_FLAG", null],
  ])("rejects malformed CLI vectors %#", (argv, code, field) => {
    const error = argumentError(argv);
    expect(error).toBeInstanceOf(MigrationArgumentError);
    expect(error).toMatchObject({ code, field });
    expect(String(error)).not.toContain("private-sentinel");
  });

  it("rejects sparse, accessor, decorated, and proxied argv", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty([], "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "--apply";
      },
    });
    const sparse = Array(1);
    const decorated = Object.assign(["--apply"], { extra: true });
    const { proxy: revoked, revoke } = Proxy.revocable(["--apply"], {});
    revoke();

    for (const argv of [
      accessor,
      sparse,
      decorated,
      Object.assign(["--apply"], { [Symbol("extra")]: true }),
      new Proxy(["--apply"], {}),
      revoked,
    ]) {
      expect(argumentError(argv)).toMatchObject({
        code: "INVALID_ARGUMENT_VECTOR",
        field: null,
      });
    }
    expect(getterCalls).toBe(0);
  });

  it("bounds argument count and UTF-8 bytes", () => {
    const tooMany = Array.from({ length: 97 }, () => "--apply");
    const oversized = ["--action", "x".repeat(4_097)];

    for (const argv of [tooMany, oversized]) {
      expect(argumentError(argv)).toMatchObject({
        code: "INVALID_ARGUMENT_VECTOR",
        field: null,
      });
    }
  });

  it.each([
    "0",
    "100001",
    "001",
    "+1",
    "1.0",
    "1e2",
    "0x10",
    " 1",
    "1 ",
    "1_000",
    "NaN",
    "Infinity",
  ])("rejects noncanonical source-row bound %s", (value) => {
    const result = evaluateMigrationPreflight({
      ...VALID_IMPORT_OPTIONS,
      "expected-source-rows": value,
    });
    expect(result.ok).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.applyConfirmation).toBeNull();
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it.each([
    ["run-id", "018F5F50-A48B-7F3C-8B28-55F43FD91DF0"],
    ["run-id", "00000000-0000-0000-0000-000000000000"],
    ["commit-sha", "A".repeat(40)],
    ["commit-sha", "a".repeat(39)],
    ["execution-manifest-sha256", "A".repeat(64)],
    ["execution-manifest-sha256", "a".repeat(63)],
    ["environment", "Test"],
    ["action", "restore"],
    ["target-project-ref", "LXvsspniipcotimbsfqm"],
    ["source-project-id", "production-private-sentinel"],
  ])("rejects noncanonical %s", (field, value) => {
    const result = evaluateMigrationPreflight({
      ...VALID_IMPORT_OPTIONS,
      [field]: value,
    });
    expect(result.ok).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.applyConfirmation).toBeNull();
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it("rejects action confusion and effect-bound widening", () => {
    const cases = [
      [
        { ...VALID_INVENTORY_OPTIONS, "max-target-reads": "1" },
        "INVARIANT_VIOLATION",
      ],
      [
        { ...VALID_INVENTORY_OPTIONS, "expected-imported-rows": "1" },
        "INVARIANT_VIOLATION",
      ],
      [
        {
          ...VALID_INVENTORY_OPTIONS,
          "source-manifest-sha256": "a".repeat(64),
        },
        "UNEXPECTED_FIELD",
      ],
      [
        { ...VALID_IMPORT_OPTIONS, "expected-imported-rows": "1989" },
        "INVARIANT_VIOLATION",
      ],
      [
        { ...VALID_IMPORT_OPTIONS, "max-quarantines": "11" },
        "INVARIANT_VIOLATION",
      ],
      [
        { ...VALID_IMPORT_OPTIONS, "max-inserts": "4000" },
        "INVARIANT_VIOLATION",
      ],
      [
        { ...VALID_IMPORT_OPTIONS, "max-updates": "2002" },
        "INVARIANT_VIOLATION",
      ],
      [
        { ...VALID_RECONCILE_OPTIONS, "max-updates": "1" },
        "INVARIANT_VIOLATION",
      ],
      [
        { ...VALID_RECONCILE_OPTIONS, "max-downtime-seconds": "1" },
        "INVARIANT_VIOLATION",
      ],
      [
        { ...VALID_RECONCILE_OPTIONS, "max-batches": "5" },
        "INVARIANT_VIOLATION",
      ],
    ];
    for (const [options, errorCode] of cases) {
      const result = evaluateMigrationPreflight(options);
      expect(result.ok).toBe(false);
      expect(result.applyConfirmation).toBeNull();
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: errorCode }),
      );
    }
  });

  it("rejects dry-run/apply confusion and every confirmation variation", () => {
    const dryRun = evaluateMigrationPreflight(VALID_IMPORT_OPTIONS);
    for (const changes of [
      { "plan-sha256": dryRun.planSha256 },
      { confirm: dryRun.applyConfirmation },
      { apply: true },
    ]) {
      const result = evaluateMigrationPreflight({
        ...VALID_IMPORT_OPTIONS,
        ...changes,
      });
      expect(result.ok).toBe(false);
      expect(result.applyConfirmation).toBeNull();
    }

    const validApply = applyOptions(VALID_IMPORT_OPTIONS, dryRun);
    for (const changes of [
      { "plan-sha256": "f".repeat(64) },
      { confirm: `${dryRun.applyConfirmation}x` },
      { confirm: dryRun.applyConfirmation.toLowerCase() },
    ]) {
      const result = evaluateMigrationPreflight(
        { ...validApply, ...changes },
        OPERATOR_ENVIRONMENT,
      );
      expect(result.ok).toBe(false);
      expect(result.confirmationMatched).toBe(false);
      expect(result.errors).toContainEqual({
        code: "CONFIRMATION_MISMATCH",
        field: "confirm",
      });
    }
    const missingOperator = evaluateMigrationPreflight(validApply, {});
    expect(missingOperator.ok).toBe(false);
    expect(missingOperator.confirmationMatched).toBe(false);
    expect(missingOperator.errors).toContainEqual({
      code: "OPERATOR_ENVIRONMENT_REQUIRED",
      field: "APP_ENV",
    });

    const credentialEnvironment = evaluateMigrationPreflight(validApply, {
      ...OPERATOR_ENVIRONMENT,
      POSTGRES_URL: "private-credential-sentinel-51e0",
    });
    expect(credentialEnvironment.ok).toBe(false);
    expect(credentialEnvironment.confirmationMatched).toBe(false);
    expect(credentialEnvironment.errors).toContainEqual({
      code: "CREDENTIALS_PRESENT",
      field: "environment",
    });
    expect(JSON.stringify(credentialEnvironment)).not.toContain(
      "private-credential-sentinel-51e0",
    );
  });

  it("rejects Production evidence in TEST and never reflects it", () => {
    const sentinel = "f".repeat(64);
    const result = evaluateMigrationPreflight({
      ...VALID_IMPORT_OPTIONS,
      "backup-evidence-sha256": sentinel,
    });

    expect(result.ok).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.errors).toContainEqual({
      code: "UNEXPECTED_FIELD",
      field: "backup-evidence-sha256",
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("refuses database and provider credentials in the pure preflight", () => {
    const sentinel = "private-credential-sentinel-3d87";
    const protectedKeys = [
      ...PROTECTED_OPERATOR_ENV_KEYS,
      "FIREBASE_SERVICE_ACCOUNT",
      "firestore_emulator_host",
      "GIOIA_PRODUCTION_MIGRATION_SECRET",
      "NEXT_PUBLIC_FIREBASE_API_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "PGPASSWORD",
      "PG_FUTURE_OVERRIDE",
      "POSTGRES_FUTURE_URL",
      "RESEND_FUTURE_TOKEN",
      "SUPABASE_PROJECT_REF",
      "VERCEL_TARGET_ENV",
    ];
    for (const key of protectedKeys) {
      expect(isProtectedOperatorEnvironmentKey(key)).toBe(true);
      const result = evaluateMigrationPreflight(VALID_IMPORT_OPTIONS, {
        [key]: sentinel,
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "CREDENTIALS_PRESENT",
        field: "environment",
      });
      expect(JSON.stringify(result)).not.toContain(sentinel);
    }
  });
});
