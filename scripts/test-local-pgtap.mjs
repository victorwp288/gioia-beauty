import { spawn } from "node:child_process";
import path from "node:path";

import postgres from "postgres";

import { getLocalRouteStatus } from "./local-owner-auth-harness.mjs";

const MEMBERSHIP_SQL = `
  select grantor.rolname as grantor
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles granted on granted.oid = membership.roleid
  join pg_catalog.pg_roles member on member.oid = membership.member
  join pg_catalog.pg_roles grantor on grantor.oid = membership.grantor
  where granted.rolname = 'app_runtime' and member.rolname = 'postgres'
  limit 2
`;

async function runPgTap() {
  const binary = path.join(process.cwd(), "node_modules", ".bin", "supabase");
  const child = spawn(binary, ["test", "db", "--local", "supabase/tests"], {
    cwd: process.cwd(),
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  if (exitCode !== 0) throw new Error("Local pgTAP suite failed");
}

async function main() {
  const status = await getLocalRouteStatus();
  const adminUrl = new URL(status.databaseUrl);
  adminUrl.username = "supabase_admin";
  const sql = postgres(adminUrl.href, {
    prepare: false,
    max: 1,
    idle_timeout: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  let granted = false;
  try {
    if ((await sql.unsafe(MEMBERSHIP_SQL)).length !== 0) {
      throw new Error(
        "Local pgTAP requires zero pre-existing runtime membership",
      );
    }
    await sql.unsafe(
      "grant app_runtime to postgres with admin true, inherit false, set false granted by current_user",
    );
    granted = true;
    await runPgTap();
  } finally {
    if (granted) {
      await sql.unsafe(
        "revoke app_runtime from postgres granted by current_user",
      );
    }
    const residue = await sql.unsafe(MEMBERSHIP_SQL);
    await sql.end({ timeout: 2 });
    if (residue.length !== 0) {
      throw new Error("Local pgTAP left runtime membership residue");
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Local pgTAP failed"}\n`,
  );
  process.exitCode = 1;
});
