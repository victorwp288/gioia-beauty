import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runMigrationPreflightCli } from "@/scripts/migration-preflight.mjs";

import {
  VALID_INVENTORY_OPTIONS,
  optionsToArgv,
} from "./migration-preflight-fixture.js";

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, "scripts/migration-preflight.mjs");

describe("migration preflight CLI", () => {
  it("emits one valid dry-run plan without side effects", () => {
    const result = runMigrationPreflightCli(
      optionsToArgv(VALID_INVENTORY_OPTIONS),
      {},
    );
    const output = JSON.parse(result.output);

    expect(result).toMatchObject({ exitCode: 0, stream: "stdout" });
    expect(output).toMatchObject({
      contractVersion: 2,
      ok: true,
      mode: "dry-run",
      plan: { action: "inventory", environment: "test" },
    });
    expect(output.applyConfirmation).toMatch(
      /^GIOIA-MIGRATION-V2:APPLY:test:inventory:/,
    );
  });

  it("never reflects unknown flags or invalid values", () => {
    const sentinel = "private-sentinel-84d95b";
    const cases = [
      [`--unknown-${sentinel}`, sentinel],
      ["--commit-sha", sentinel],
      ["--confirm", sentinel],
    ];
    for (const extra of cases) {
      const result = runMigrationPreflightCli(
        [...optionsToArgv(VALID_INVENTORY_OPTIONS), ...extra],
        { PRIVATE_VALUE: sentinel },
      );
      expect(result.exitCode).toBe(2);
      expect(result.output).not.toContain(sentinel);
      expect(result.output).not.toContain('applyConfirmation": "GIOIA');
    }
  });

  it("does not reflect hostile Production approval environment values", () => {
    const sentinel = "private-approval-sentinel-28fc";
    const options = {
      ...VALID_INVENTORY_OPTIONS,
      apply: true,
      "plan-sha256": "a".repeat(64),
      confirm: "invalid-confirmation",
    };
    const result = runMigrationPreflightCli(optionsToArgv(options), {
      APP_ENV: "operator",
      GIOIA_PRODUCTION_APPROVAL_ID: sentinel,
      GIOIA_PRODUCTION_APPROVAL_PLAN_SHA256: sentinel,
    });

    expect(result.exitCode).toBe(2);
    expect(result.output).not.toContain(sentinel);
  });

  it("is inert when imported as a module", () => {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'await import("./scripts/migration-preflight.mjs")',
      ],
      { cwd: ROOT, encoding: "utf8" },
    );

    expect(child.status).toBe(0);
    expect(child.stdout).toBe("");
    expect(child.stderr).toBe("");
  });

  it("uses fixed redacted JSON and exit 2 for the real invalid CLI", () => {
    const sentinel = "private-cli-sentinel-41a7";
    const child = spawnSync(
      process.execPath,
      [SCRIPT, `--unknown-${sentinel}`, sentinel],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, SECRET: sentinel },
      },
    );

    expect(child.status).toBe(2);
    expect(child.stdout).toBe("");
    expect(child.stderr).not.toContain(sentinel);
    expect(JSON.parse(child.stderr)).toEqual({
      contractVersion: 2,
      ok: false,
      error: { code: "UNKNOWN_FLAG", field: null },
    });
  });
});
