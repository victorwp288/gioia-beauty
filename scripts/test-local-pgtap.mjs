import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { getLocalRouteStatus } from "./local-owner-auth-harness.mjs";

export const LOCAL_PGTAP_CREATOR_ROLES = Object.freeze([
  "app_runtime",
  "gioia_mutator",
  "gioia_migrator",
]);
export const LOCAL_PGTAP_CREATOR_MEMBERSHIP_SQL = `
  select granted.rolname as granted_role, grantor.rolname as grantor,
    membership.admin_option, membership.inherit_option, membership.set_option
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles granted on granted.oid = membership.roleid
  join pg_catalog.pg_roles member on member.oid = membership.member
  join pg_catalog.pg_roles grantor on grantor.oid = membership.grantor
  where granted.rolname in (
    'app_runtime','gioia_mutator','gioia_migrator'
  )
    and member.rolname = 'postgres'
  order by granted.rolname, grantor.rolname
`;

function exactCreatorMembershipSnapshot(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Local pgTAP creator membership snapshot is invalid");
  }
  const roles = rows.map((row) => row.granted_role);
  if (!(
    new Set(roles).size === roles.length &&
    roles.every((role) => LOCAL_PGTAP_CREATOR_ROLES.includes(role)) &&
    rows.every(
      (row) =>
        row.grantor === "supabase_admin" &&
        row.admin_option === true &&
        row.inherit_option === false &&
        row.set_option === false,
    )
  )) {
    throw new Error("Local pgTAP found unexpected Gioia role membership");
  }
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        admin_option: row.admin_option,
        granted_role: row.granted_role,
        grantor: row.grantor,
        inherit_option: row.inherit_option,
        set_option: row.set_option,
      }),
    ),
  );
}

function sameCreatorMemberships(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function membershipGrantSql(role) {
  return `grant ${role} to postgres with admin true, inherit false, set false granted by current_user`;
}

function membershipRevokeSql(role) {
  return `revoke ${role} from postgres granted by current_user`;
}

export async function withLocalPgTapCreatorMemberships(sql, callback) {
  if (
    !sql ||
    typeof sql.unsafe !== "function" ||
    typeof callback !== "function"
  ) {
    throw new Error("Local pgTAP creator membership lifecycle is invalid");
  }
  const before = exactCreatorMembershipSnapshot(
    await sql.unsafe(LOCAL_PGTAP_CREATOR_MEMBERSHIP_SQL),
  );
  const existingRoles = new Set(before.map((row) => row.granted_role));
  const temporaryRoles = LOCAL_PGTAP_CREATOR_ROLES.filter(
    (role) => !existingRoles.has(role),
  );
  let operationError;
  let result;
  try {
    for (const role of temporaryRoles) {
      await sql.unsafe(membershipGrantSql(role));
    }
    result = await callback();
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = [];
  for (const role of [...temporaryRoles].reverse()) {
    try {
      await sql.unsafe(membershipRevokeSql(role));
    } catch {
      cleanupErrors.push(
        new Error(`Local pgTAP temporary ${role} membership was not revoked`),
      );
    }
  }
  try {
    const after = exactCreatorMembershipSnapshot(
      await sql.unsafe(LOCAL_PGTAP_CREATOR_MEMBERSHIP_SQL),
    );
    if (!sameCreatorMemberships(after, before)) {
      cleanupErrors.push(
        new Error("Local pgTAP did not restore creator memberships exactly"),
      );
    }
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (operationError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      "Local pgTAP operation and creator membership cleanup failed",
    );
  }
  if (operationError) throw operationError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(
      cleanupErrors,
      "Local pgTAP creator membership cleanup failed",
    );
  }
  return result;
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
  try {
    await withLocalPgTapCreatorMemberships(sql, runPgTap);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Local pgTAP failed"}\n`,
    );
    process.exitCode = 1;
  });
}
