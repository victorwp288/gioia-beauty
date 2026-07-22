import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GREENFIELD_BASELINE_VERSIONS,
  GREENFIELD_REVIEWED_MANIFEST_SHA256,
  GREENFIELD_TARGET_VERSIONS,
  migrationChecksumManifest,
  remotePgTapFiles,
  repositoryMigrationFiles,
} from "../../scripts/test-target-migrations.mjs";

const temporaryDirectories = [];

function temporaryRepository() {
  const root = mkdtempSync(path.join(tmpdir(), "gioia-migration-manifest-"));
  temporaryDirectories.push(root);
  mkdirSync(path.join(root, "supabase", "migrations"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("greenfield TEST migration manifest", () => {
  it("matches the reviewed repository sequence and hashes every file", () => {
    const files = repositoryMigrationFiles();
    const manifest = migrationChecksumManifest();

    expect(GREENFIELD_BASELINE_VERSIONS).toHaveLength(35);
    expect(GREENFIELD_TARGET_VERSIONS).toHaveLength(68);
    expect(files).toHaveLength(68);
    expect(manifest.map(({ file }) => file)).toEqual(files);
    expect(manifest.every(({ sha256 }) => /^[0-9a-f]{64}$/u.test(sha256))).toBe(
      true,
    );
    expect(GREENFIELD_REVIEWED_MANIFEST_SHA256).toBe(
      "17b9428bd0ee692b7e15223d9b909ae4982a953e898058d175239ebd2b021d2c",
    );
  });

  it("rejects a missing, duplicate, or unreviewed migration version", () => {
    const root = temporaryRepository();
    const directory = path.join(root, "supabase", "migrations");
    for (const version of GREENFIELD_TARGET_VERSIONS.slice(0, -1)) {
      writeFileSync(
        path.join(directory, `${version}_reviewed.sql`),
        "select 1;\n",
      );
    }
    writeFileSync(
      path.join(directory, "20990101000000_unreviewed.sql"),
      "select 1;\n",
    );

    expect(() => repositoryMigrationFiles(root)).toThrow(
      "not the reviewed set",
    );
  });

  it("rejects modified SQL even when every reviewed filename is present", () => {
    const root = temporaryRepository();
    const target = path.join(root, "supabase", "migrations");
    const files = repositoryMigrationFiles();
    for (const file of files) {
      copyFileSync(
        path.join(process.cwd(), "supabase", "migrations", file),
        path.join(target, file),
      );
    }
    appendFileSync(path.join(target, files[0]), "\n-- unreviewed mutation\n");

    expect(() => repositoryMigrationFiles(root)).toThrow(
      "migration digest is not reviewed",
    );
  });
});

describe("greenfield TEST remote pgTAP manifest", () => {
  it("excludes the local synthetic seed and pins the reviewed plan total", () => {
    const suite = remotePgTapFiles();

    expect(suite).toMatchObject({ assertions: 475 });
    expect(suite.files).toHaveLength(31);
    expect(suite.files).not.toContain(
      "supabase/tests/005_synthetic_seed.test.sql",
    );
    expect(suite.files.every((file) => file.endsWith(".test.sql"))).toBe(true);
  });
});
