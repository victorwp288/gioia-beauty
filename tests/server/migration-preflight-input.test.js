import { describe, expect, it } from "vitest";

import { evaluateMigrationPreflight } from "@/lib/server/migrationPreflight.mjs";

import {
  VALID_IMPORT_OPTIONS,
  applyOptions,
} from "./migration-preflight-fixture.js";

describe("migration preflight caller input isolation", () => {
  it("rejects hostile option objects without invoking coercion", () => {
    let getterCalls = 0;
    let coercionCalls = 0;
    const accessor = Object.defineProperty(
      { ...VALID_IMPORT_OPTIONS },
      "commit-sha",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "private-sentinel";
        },
      },
    );
    class Options {
      constructor() {
        Object.assign(this, VALID_IMPORT_OPTIONS);
      }
    }
    const { proxy: revoked, revoke } = Proxy.revocable({}, {});
    revoke();
    const coercible = {
      ...VALID_IMPORT_OPTIONS,
      "expected-source-rows": {
        toString() {
          coercionCalls += 1;
          return "2000";
        },
        valueOf() {
          coercionCalls += 1;
          return 2000;
        },
      },
    };

    for (const options of [
      accessor,
      new Options(),
      Object.create(VALID_IMPORT_OPTIONS),
      { ...VALID_IMPORT_OPTIONS, extra: "private-sentinel" },
      { ...VALID_IMPORT_OPTIONS, [Symbol("extra")]: "private-sentinel" },
      new Proxy(VALID_IMPORT_OPTIONS, {}),
      revoked,
      coercible,
      null,
      [],
    ]) {
      const result = evaluateMigrationPreflight(options);
      expect(result).toMatchObject({
        ok: false,
        mode: null,
        plan: null,
        applyConfirmation: null,
        errors: [{ code: "INVALID_OPTIONS", field: "options" }],
      });
      expect(JSON.stringify(result)).not.toContain("private-sentinel");
    }
    expect(getterCalls).toBe(0);
    expect(coercionCalls).toBe(0);
  });

  it("never invokes hostile environment accessors or proxies", () => {
    let getterCalls = 0;
    const environment = Object.defineProperty({}, "APP_ENV", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "operator";
      },
    });
    const dryRun = evaluateMigrationPreflight(VALID_IMPORT_OPTIONS);
    const options = applyOptions(VALID_IMPORT_OPTIONS, dryRun);

    for (const hostileEnvironment of [
      environment,
      new Proxy({ APP_ENV: "operator" }, {}),
    ]) {
      const result = evaluateMigrationPreflight(options, hostileEnvironment);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "OPERATOR_ENVIRONMENT_REQUIRED",
        field: "APP_ENV",
      });
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects an invalid dry-run environment container", () => {
    for (const environment of [null, [], new Proxy({}, {})]) {
      const result = evaluateMigrationPreflight(
        VALID_IMPORT_OPTIONS,
        environment,
      );
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "INVALID_ENVIRONMENT",
        field: "environment",
      });
    }
  });

  it("snapshots valid caller input into an immutable plan", () => {
    const mutable = { ...VALID_IMPORT_OPTIONS };
    const result = evaluateMigrationPreflight(mutable);
    mutable["max-target-reads"] = "9999";
    mutable["commit-sha"] = "f".repeat(40);

    expect(result.ok).toBe(true);
    expect(result.plan.bounds.maxTargetReads).toBe(5000);
    expect(result.plan.commitSha).not.toBe(mutable["commit-sha"]);
    expect(Object.isFrozen(result.errors)).toBe(true);
  });
});
