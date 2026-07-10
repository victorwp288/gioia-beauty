import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { withLocalRuntimeDatabase } from "./concurrency-harness.mjs";
import {
  getLocalRouteStatus,
  withLocalOwnerAuthServer,
} from "./local-owner-auth-harness.mjs";
import { runOwnerAuthRouteScenario } from "./owner-auth-route-scenario.mjs";
import { LOCAL_SYNTHETIC_OWNER } from "./test-local-auth-seed.mjs";

const LOCAL_COOKIE_SECURITY = {
  session: {
    required: ["httponly", "path=/", "samesite=strict", "max-age=43200"],
    forbidden: ["secure"],
  },
  csrf: {
    required: ["path=/", "samesite=strict", "max-age=43200"],
    forbidden: ["httponly", "secure"],
  },
  supabase: {
    namePrefix: "sb-127-auth-token",
    required: ["httponly", "path=/", "samesite=lax"],
    forbidden: ["secure"],
  },
};

async function reconcileLedger(databaseUrl, ownerId) {
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  try {
    const [row] = await sql.unsafe(
      "select count(*)::integer as total, " +
        "count(*) filter (where revoked_at is not null)::integer as revoked, " +
        "count(*) filter (where revoked_at is null and expires_at > clock_timestamp())::integer as active " +
        "from gioia_private.owner_sessions where user_id = $1::uuid",
      [ownerId],
    );
    if (row?.total !== 1 || row.revoked !== 1 || row.active !== 0) {
      throw new Error("Owner session ledger did not reconcile after logout");
    }
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export async function runLocalOwnerAuthRouteTest() {
  const status = await getLocalRouteStatus();
  await withLocalRuntimeDatabase(() =>
    withLocalOwnerAuthServer(status, (baseUrl) =>
      runOwnerAuthRouteScenario({
        baseUrl,
        owner: LOCAL_SYNTHETIC_OWNER,
        cookieSecurity: LOCAL_COOKIE_SECURITY,
        reconcileLedger: () =>
          reconcileLedger(status.databaseUrl, LOCAL_SYNTHETIC_OWNER.id),
      }),
    ),
  );
  process.stdout.write(
    "Local owner route login, logout, and replay rejection passed.\n",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLocalOwnerAuthRouteTest().catch((error) => {
    process.stderr.write(
      `Local owner Auth route test failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
