import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { postgresEnvironment } from "./local-postgres-clone-contract.mjs";

const execFileAsync = promisify(execFile);
export const LOCAL_SUPABASE_CLI_PATH = fileURLToPath(
  new URL("../node_modules/.bin/supabase", import.meta.url),
);
const TOOL_NAMES = Object.freeze([
  "pg_dump",
  "pg_restore",
  "createdb",
  "dropdb",
  "psql",
]);
const VERSION_PATTERN = /\(PostgreSQL\) 17(?:\.|\s|$)/u;

const LIMITS = Object.freeze({
  normal: { maxBuffer: 1024 * 1024, timeout: 30_000 },
  restore: { maxBuffer: 4 * 1024 * 1024, timeout: 180_000 },
  toc: { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 },
});

export class LocalPostgresCloneError extends Error {
  constructor(stage) {
    super(`Local Postgres clone failed during ${stage}`);
    this.name = "LocalPostgresCloneError";
  }
}

async function execute(
  stage,
  executable,
  args,
  options,
  execFileImpl = execFileAsync,
) {
  try {
    const result = await execFileImpl(executable, args, {
      encoding: "utf8",
      windowsHide: true,
      ...options,
    });
    return {
      stdout: typeof result?.stdout === "string" ? result.stdout : "",
      stderr: typeof result?.stderr === "string" ? result.stderr : "",
    };
  } catch {
    throw new LocalPostgresCloneError(stage);
  }
}

function childOptions(
  connection,
  database,
  limits = LIMITS.normal,
  user = connection.user,
) {
  return {
    ...limits,
    env: {
      ...postgresEnvironment(connection, database, user),
      LC_ALL: "C",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
    },
  };
}

export async function readLocalSupabaseStatus(execFileImpl = execFileAsync) {
  const { stdout } = await execute(
    "local status",
    LOCAL_SUPABASE_CLI_PATH,
    ["status", "--output", "json"],
    LIMITS.normal,
    execFileImpl,
  );
  try {
    return JSON.parse(stdout);
  } catch {
    throw new LocalPostgresCloneError("local status validation");
  }
}

export async function assertPostgres17Toolchain(
  connection,
  execFileImpl = execFileAsync,
) {
  for (const tool of TOOL_NAMES) {
    const { stdout, stderr } = await execute(
      `${tool} version preflight`,
      tool,
      ["--version"],
      LIMITS.normal,
      execFileImpl,
    );
    if (!VERSION_PATTERN.test(`${stdout}\n${stderr}`)) {
      throw new LocalPostgresCloneError(`${tool} version preflight`);
    }
  }
  return readPostgresDatabaseIdentity(
    connection,
    connection.sourceDatabase,
    execFileImpl,
  );
}

export async function readPostgresDatabaseIdentity(
  connection,
  database,
  execFileImpl = execFileAsync,
) {
  const { stdout } = await execute(
    "database identity preflight",
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--command",
      "select pg_catalog.json_build_object('database', current_database(), 'user', current_user, 'serverMajor', current_setting('server_version_num')::integer / 10000, 'encoding', pg_catalog.pg_encoding_to_char(d.encoding), 'collation', d.datcollate, 'ctype', d.datctype)::text from pg_catalog.pg_database d where d.datname = current_database()",
    ],
    childOptions(connection, database),
    execFileImpl,
  );
  let identity;
  try {
    identity = JSON.parse(stdout.trim());
  } catch {
    throw new LocalPostgresCloneError("database identity preflight");
  }
  if (
    identity?.database !== database ||
    identity?.user !== connection.user ||
    identity?.serverMajor !== 17 ||
    identity?.encoding !== "UTF8" ||
    typeof identity?.collation !== "string" ||
    identity.collation.length === 0 ||
    typeof identity?.ctype !== "string" ||
    identity.ctype.length === 0
  ) {
    throw new LocalPostgresCloneError("database identity preflight");
  }
  return Object.freeze(identity);
}

export async function assertLocalCloneAbsent(
  connection,
  execFileImpl = execFileAsync,
) {
  const { stdout } = await execute(
    "scratch database preflight",
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--command",
      "select count(*)::text from pg_catalog.pg_database where datname = current_setting('gioia.clone_database', true)",
    ],
    {
      ...childOptions(connection, connection.sourceDatabase),
      env: {
        ...childOptions(connection, connection.sourceDatabase).env,
        PGOPTIONS: `-c gioia.clone_database=${connection.targetDatabase}`,
      },
    },
    execFileImpl,
  );
  if (stdout.trim() !== "0") {
    throw new LocalPostgresCloneError("scratch database preflight");
  }
}

export function assertMatchingDatabaseIdentity(source, clone) {
  for (const key of ["serverMajor", "encoding", "collation", "ctype"]) {
    if (source[key] !== clone[key]) {
      throw new LocalPostgresCloneError("source and clone identity comparison");
    }
  }
}

export async function dropLocalClone(connection, execFileImpl = execFileAsync) {
  await execute(
    "scratch database cleanup",
    "dropdb",
    ["--force", "--if-exists", connection.targetDatabase],
    childOptions(connection, connection.sourceDatabase),
    execFileImpl,
  );
}

export async function createLocalClone(
  connection,
  execFileImpl = execFileAsync,
) {
  await execute(
    "scratch database creation",
    "createdb",
    [
      "--template=template0",
      "--encoding=UTF8",
      `--owner=${connection.user}`,
      connection.targetDatabase,
    ],
    childOptions(connection, connection.sourceDatabase),
    execFileImpl,
  );
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

export async function dumpLocalSource(
  connection,
  dumpPath,
  tocPath,
  execFileImpl = execFileAsync,
) {
  await execute(
    "logical dump",
    "pg_dump",
    [
      "--format=custom",
      "--compress=zstd:9",
      "--serializable-deferrable",
      "--lock-wait-timeout=10s",
      "--no-publications",
      "--no-subscriptions",
      `--file=${dumpPath}`,
    ],
    childOptions(connection, connection.sourceDatabase, LIMITS.restore),
    execFileImpl,
  );
  await chmod(dumpPath, 0o600);
  const { stdout: toc } = await execute(
    "dump TOC generation",
    "pg_restore",
    ["--list", dumpPath],
    childOptions(connection, connection.sourceDatabase, LIMITS.toc),
    execFileImpl,
  );
  const dumpStat = await stat(dumpPath);
  const entries = toc
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith(";")).length;
  if (dumpStat.size <= 0 || entries <= 0) {
    throw new LocalPostgresCloneError("logical dump validation");
  }
  await writeFile(tocPath, toc, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return Object.freeze({
    bytes: dumpStat.size,
    sha256: await sha256File(dumpPath),
    tocEntries: entries,
    tocSha256: createHash("sha256").update(toc).digest("hex"),
  });
}

export async function restoreLocalClone(
  connection,
  dumpPath,
  execFileImpl = execFileAsync,
) {
  await execute(
    "logical restore",
    "pg_restore",
    [
      "--single-transaction",
      "--exit-on-error",
      `--dbname=${connection.targetDatabase}`,
      dumpPath,
    ],
    childOptions(
      connection,
      connection.targetDatabase,
      LIMITS.restore,
      connection.restoreUser,
    ),
    execFileImpl,
  );
}

export async function queryLocalClone(
  connection,
  sql,
  execFileImpl = execFileAsync,
) {
  if (typeof sql !== "string" || sql.length === 0 || sql.includes("\0")) {
    throw new Error("Clone query must be non-empty SQL text");
  }
  const { stdout } = await execute(
    "clone inspection",
    "psql",
    ["--no-psqlrc", "--tuples-only", "--no-align", "--command", sql],
    childOptions(connection, connection.targetDatabase),
    execFileImpl,
  );
  return stdout;
}
