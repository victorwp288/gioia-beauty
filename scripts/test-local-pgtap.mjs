import { spawn } from "node:child_process";
import path from "node:path";

import postgres from "postgres";

import { getLocalRouteStatus } from "./local-owner-auth-harness.mjs";

const TEST_ROLES = ["app_runtime", "gioia_mutator", "gioia_migrator"];
const MEMBERSHIP_SQL = `
  select granted.rolname as granted_role, grantor.rolname as grantor,
    membership.admin_option, membership.inherit_option, membership.set_option
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles granted on granted.oid = membership.roleid
  join pg_catalog.pg_roles member on member.oid = membership.member
  join pg_catalog.pg_roles grantor on grantor.oid = membership.grantor
  where granted.rolname in ('app_runtime','gioia_mutator','gioia_migrator')
    and member.rolname = 'postgres'
  order by granted.rolname
`;

function isResetMembershipSubset(rows) {
  const roles = rows.map((row) => row.granted_role);
  return (
    new Set(roles).size === roles.length &&
    roles.every((role) => TEST_ROLES.includes(role)) &&
    rows.every(
      (row) =>
        row.grantor === "supabase_admin" &&
        row.admin_option === true &&
        row.inherit_option === false &&
        row.set_option === false,
    )
  );
}

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
    const existing = await sql.unsafe(MEMBERSHIP_SQL);
    if (existing.length !== 0) {
      if (!isResetMembershipSubset(existing)) {
        throw new Error("Local pgTAP found unexpected Gioia role membership");
      }
      await sql.unsafe(
        `revoke ${TEST_ROLES.join(", ")} from postgres granted by current_user`,
      );
    }
    await sql.unsafe(
      `grant ${TEST_ROLES.join(", ")} to postgres with admin true, inherit false, set false granted by current_user`,
    );
    granted = true;
    await runPgTap();
  } finally {
    if (granted) {
      await sql.unsafe(
        `revoke ${TEST_ROLES.join(", ")} from postgres granted by current_user`,
      );
    }
    const residue = await sql.unsafe(MEMBERSHIP_SQL);
    await sql.end({ timeout: 2 });
    if (residue.length !== 0) {
      throw new Error("Local pgTAP left Gioia role membership residue");
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Local pgTAP failed"}\n`,
  );
  process.exitCode = 1;
});
