import { types } from "node:util";

import { isProtectedOperatorEnvironmentKey } from "../../config/operatorEnvironmentPolicy.mjs";

const MAX_ARGUMENTS = 96;
const MAX_ARGUMENT_BYTES = 4_096;

export const MIGRATION_VALUE_FLAGS = Object.freeze([
  "action",
  "environment",
  "target-project-ref",
  "source-project-id",
  "run-id",
  "commit-sha",
  "execution-manifest-sha256",
  "source-manifest-sha256",
  "reconciliation-manifest-sha256",
  "stop-conditions-sha256",
  "recovery-plan-sha256",
  "expected-source-rows",
  "expected-imported-rows",
  "expected-quarantined-rows",
  "max-source-reads",
  "max-target-reads",
  "max-inserts",
  "max-updates",
  "max-deletes",
  "max-quarantines",
  "batch-size",
  "max-batches",
  "max-errors",
  "max-duration-seconds",
  "max-downtime-seconds",
  "export-evidence-sha256",
  "backup-evidence-sha256",
  "restore-evidence-sha256",
  "write-freeze-evidence-sha256",
  "rehearsal-evidence-sha256",
  "recovery-evidence-sha256",
  "plan-sha256",
  "confirm",
]);

const VALUE_FLAG_SET = new Set(MIGRATION_VALUE_FLAGS);
const OPTION_FIELD_SET = new Set([...MIGRATION_VALUE_FLAGS, "apply"]);

export class MigrationArgumentError extends Error {
  constructor(code, field = null) {
    super("Migration arguments are invalid");
    this.name = "MigrationArgumentError";
    this.code = code;
    this.field = field;
  }
}

function exactDenseStringArray(value) {
  try {
    if (
      !Array.isArray(value) ||
      types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > MAX_ARGUMENTS
    ) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes("length")) {
      return null;
    }
    const copy = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        typeof descriptor.value !== "string" ||
        Buffer.byteLength(descriptor.value, "utf8") > MAX_ARGUMENT_BYTES
      ) {
        return null;
      }
      Object.defineProperty(copy, String(index), {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

export function parseMigrationArguments(argv) {
  const input = exactDenseStringArray(argv);
  if (!input) {
    throw new MigrationArgumentError("INVALID_ARGUMENT_VECTOR");
  }

  const values = Object.create(null);
  let apply = false;
  for (let index = 0; index < input.length; index += 1) {
    const token = input[index];
    if (token === "--apply") {
      if (apply) throw new MigrationArgumentError("DUPLICATE_FLAG", "apply");
      apply = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new MigrationArgumentError("UNEXPECTED_ARGUMENT");
    }
    const name = token.slice(2);
    if (!VALUE_FLAG_SET.has(name)) {
      throw new MigrationArgumentError("UNKNOWN_FLAG");
    }
    if (Object.hasOwn(values, name)) {
      throw new MigrationArgumentError("DUPLICATE_FLAG", name);
    }
    const value = input[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new MigrationArgumentError("MISSING_FLAG_VALUE", name);
    }
    Object.defineProperty(values, name, {
      value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
    index += 1;
  }
  Object.defineProperty(values, "apply", {
    value: apply,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return Object.freeze(values);
}

export function snapshotMigrationOptions(value) {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      types.isProxy(value)
    ) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      !keys.includes("apply") ||
      keys.some((key) => typeof key !== "string" || !OPTION_FIELD_SET.has(key))
    ) {
      return null;
    }
    const copy = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      if (
        (key === "apply" && typeof descriptor.value !== "boolean") ||
        (key !== "apply" &&
          (typeof descriptor.value !== "string" ||
            Buffer.byteLength(descriptor.value, "utf8") > MAX_ARGUMENT_BYTES))
      ) {
        return null;
      }
      Object.defineProperty(copy, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

export function ownEnvironmentString(environment, key) {
  try {
    if (
      typeof environment !== "object" ||
      environment === null ||
      Array.isArray(environment) ||
      types.isProxy(environment)
    ) {
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, key);
    return descriptor &&
      "value" in descriptor &&
      descriptor.enumerable &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

export function protectedEnvironmentState(environment) {
  try {
    if (
      typeof environment !== "object" ||
      environment === null ||
      Array.isArray(environment) ||
      types.isProxy(environment)
    ) {
      return null;
    }
    return Reflect.ownKeys(environment).some(
      (key) =>
        typeof key === "string" && isProtectedOperatorEnvironmentKey(key),
    );
  } catch {
    return null;
  }
}
