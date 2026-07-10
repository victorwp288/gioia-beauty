import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import postgres from "postgres";

import { getLocalRouteStatus } from "./local-owner-auth-harness.mjs";
import { LOCAL_SYNTHETIC_OWNER } from "./test-local-auth-seed.mjs";

const MAX_SEED_BYTES = 64 * 1_024;

export function localSeedPath(root = process.cwd()) {
  const resolvedRoot = path.resolve(root);
  const seedPath = path.resolve(
    resolvedRoot,
    "supabase/seeds/00_synthetic.sql",
  );
  if (!seedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Synthetic seed path escaped the repository");
  }
  return seedPath;
}

async function requireBoundedSeedFile(seedPath) {
  const metadata = await stat(seedPath);
  if (
    !metadata.isFile() ||
    metadata.size < 1 ||
    metadata.size > MAX_SEED_BYTES
  ) {
    throw new Error("Synthetic seed file is missing or unbounded");
  }
}

async function reconcileSyntheticOwner(sql) {
  const [row] = await sql.unsafe(
    "select " +
      "(select count(*) from auth.users where id = $1::uuid)::integer as users, " +
      "(select count(*) from auth.identities where user_id = $1::uuid)::integer as identities, " +
      "(select count(*) from gioia_private.owner_accounts " +
      "where user_id = $1::uuid and role = 'owner' and enabled)::integer as owners",
    [LOCAL_SYNTHETIC_OWNER.id],
  );
  if (row?.users !== 1 || row.identities !== 1 || row.owners !== 1) {
    throw new Error("Synthetic owner seed did not reconcile exactly");
  }
}

export async function replayLocalSeed() {
  const status = await getLocalRouteStatus();
  const seedPath = localSeedPath();
  await requireBoundedSeedFile(seedPath);
  const sql = postgres(status.databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  try {
    await sql.file(seedPath);
    await reconcileSyntheticOwner(sql);
  } finally {
    await sql.end({ timeout: 2 });
  }
  process.stdout.write("Synthetic local seed replay reconciled exactly.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  replayLocalSeed().catch((error) => {
    process.stderr.write(
      `Synthetic local seed replay failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
