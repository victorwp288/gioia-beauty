import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  REVIEWED_MIGRATION_DIGESTS,
  REVIEWED_REMOTE_PGTAP_DIGESTS,
} from "./test-target-reviewed-manifest.mjs";

export const GREENFIELD_TARGET_FILES = Object.freeze(
  Object.keys(REVIEWED_MIGRATION_DIGESTS),
);
export const GREENFIELD_TARGET_VERSIONS = Object.freeze(
  GREENFIELD_TARGET_FILES.map((file) => file.slice(0, 14)),
);
export const GREENFIELD_BASELINE_VERSIONS = Object.freeze(
  GREENFIELD_TARGET_VERSIONS.slice(0, 35),
);
export const GREENFIELD_REMOTE_PGTAP_FILES = Object.freeze(
  Object.keys(REVIEWED_REMOTE_PGTAP_DIGESTS),
);

function exactList(actual, expected, message) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(message);
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function migrationDirectory(rootDirectory) {
  return path.join(rootDirectory, "supabase", "migrations");
}

export function repositoryMigrationFiles(rootDirectory = process.cwd()) {
  const files = readdirSync(migrationDirectory(rootDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  exactList(
    files,
    GREENFIELD_TARGET_FILES,
    "Greenfield TEST migration files are not the reviewed set",
  );
  for (const file of files) {
    if (
      sha256(path.join(migrationDirectory(rootDirectory), file)) !==
      REVIEWED_MIGRATION_DIGESTS[file]
    ) {
      throw new Error("Greenfield TEST migration digest is not reviewed");
    }
  }
  return files;
}

export function migrationChecksumManifest(rootDirectory = process.cwd()) {
  return repositoryMigrationFiles(rootDirectory).map((file) => ({
    file,
    sha256: REVIEWED_MIGRATION_DIGESTS[file],
  }));
}

export function remotePgTapFiles(rootDirectory = process.cwd()) {
  const directory = path.join(rootDirectory, "supabase", "tests");
  const names = readdirSync(directory)
    .filter(
      (file) =>
        file.endsWith(".test.sql") && file !== "005_synthetic_seed.test.sql",
    )
    .sort();
  exactList(
    names,
    GREENFIELD_REMOTE_PGTAP_FILES,
    "Greenfield TEST pgTAP files are not the reviewed set",
  );
  for (const file of names) {
    if (
      sha256(path.join(directory, file)) !== REVIEWED_REMOTE_PGTAP_DIGESTS[file]
    ) {
      throw new Error("Greenfield TEST pgTAP digest is not reviewed");
    }
  }
  const files = names.map((file) => path.join("supabase", "tests", file));
  const assertions = files.reduce((total, file) => {
    const source = readFileSync(path.join(rootDirectory, file), "utf8");
    const match = source.match(/select plan\((\d+)\);/u);
    if (!match) throw new Error("Greenfield TEST pgTAP plan is missing");
    return total + Number(match[1]);
  }, 0);
  if (files.length !== 20 || assertions !== 318) {
    throw new Error("Greenfield TEST pgTAP suite is not the reviewed set");
  }
  return { assertions, files };
}
