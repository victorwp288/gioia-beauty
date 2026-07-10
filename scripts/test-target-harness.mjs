import { randomBytes } from "node:crypto";

import postgres from "postgres";

const GLOBAL_LOCK_SQL =
  "select pg_catalog.pg_try_advisory_lock(7102026, 72135538) as acquired";
const GLOBAL_UNLOCK_SQL =
  "select pg_catalog.pg_advisory_unlock(7102026, 72135538) as released";
const RUNTIME_PASSWORD_CONFIG_SQL =
  "select set_config('gioia.test_runtime_password', $1, true)";
const RUNTIME_ROLE_GRANT_SQL =
  "grant app_runtime to postgres with inherit false, set true granted by current_user";
const RUNTIME_ROLE_ALTER_SQL = `
  do $role$
  begin
    execute pg_catalog.format(
      'alter role app_runtime login password %L valid until %L',
      pg_catalog.current_setting('gioia.test_runtime_password'),
      pg_catalog.clock_timestamp() + interval '15 minutes'
    );
  end
  $role$
`;
const RUNTIME_ROLE_DISABLE_SQL =
  "alter role app_runtime nologin password null valid until 'infinity'";
const RUNTIME_ROLE_REVOKE_SQL =
  "revoke app_runtime from postgres granted by current_user";
const RUNTIME_SESSION_TERMINATE_SQL = `
  select pg_catalog.pg_terminate_backend(pid) as terminated
  from pg_catalog.pg_stat_activity
  where pid <> pg_catalog.pg_backend_pid()
    and datname = pg_catalog.current_database()
    and (usename = 'app_runtime' or application_name = 'gioia_public_api')
`;
const RUNTIME_SESSION_STATE_SQL = `
  select count(*)::integer as active
  from pg_catalog.pg_stat_activity
  where pid <> pg_catalog.pg_backend_pid()
    and datname = pg_catalog.current_database()
    and (usename = 'app_runtime' or application_name = 'gioia_public_api')
`;
const RUNTIME_ROLE_STATE_SQL = `
  select role.rolcanlogin,
    exists (
      select 1 from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
      where (granted.rolname = 'app_runtime'
        and (member.rolname <> 'postgres' or not membership.admin_option
          or membership.inherit_option or membership.set_option))
        or member.rolname = 'app_runtime'
    ) as has_unsafe_membership
  from pg_catalog.pg_roles role
  where role.rolname = 'app_runtime'
`;

export const GREENFIELD_TEST_LOCK_SQL = GLOBAL_LOCK_SQL;
export const GREENFIELD_TEST_UNLOCK_SQL = GLOBAL_UNLOCK_SQL;
export const GREENFIELD_RUNTIME_ROLE_SQL = Object.freeze({
  setup: Object.freeze([
    RUNTIME_PASSWORD_CONFIG_SQL,
    RUNTIME_ROLE_GRANT_SQL,
    RUNTIME_ROLE_ALTER_SQL,
  ]),
  cleanup: Object.freeze([RUNTIME_ROLE_DISABLE_SQL, RUNTIME_ROLE_REVOKE_SQL]),
  sessions: Object.freeze([
    RUNTIME_SESSION_TERMINATE_SQL,
    RUNTIME_SESSION_STATE_SQL,
  ]),
  state: RUNTIME_ROLE_STATE_SQL,
});

function databaseClient(
  databaseUrl,
  max,
  clientFactory = postgres,
  { persistent = false } = {},
) {
  return clientFactory(databaseUrl, {
    prepare: false,
    ssl: "verify-full",
    max,
    idle_timeout: persistent ? null : 5,
    connect_timeout: 10,
    max_lifetime: persistent ? null : 120,
    onnotice: () => {},
    connection: { application_name: "gioia_greenfield_test" },
  });
}

async function endClient(client) {
  await client.end({ timeout: 5 });
}

export async function withGreenfieldTestLock(
  config,
  callback,
  { clientFactory = postgres } = {},
) {
  if (typeof callback !== "function") {
    throw new Error("Greenfield TEST lock requires a callback");
  }
  const lockPool = databaseClient(
    config.getOperatorSessionDatabaseUrl(),
    1,
    clientFactory,
    { persistent: true },
  );
  const worker = databaseClient(
    config.getOperatorWorkerDatabaseUrl(),
    21,
    clientFactory,
  );
  let lockClient;
  let locked = false;
  try {
    lockClient = await lockPool.reserve();
    const [lock, ...extra] = await lockClient.unsafe(GLOBAL_LOCK_SQL);
    if (lock?.acquired !== true || extra.length !== 0) {
      throw new Error("Greenfield TEST target is already locked");
    }
    locked = true;
    return await callback({
      worker,
      recoverRuntimeRole: () => cleanupRuntimeRole(lockClient),
    });
  } finally {
    try {
      await endClient(worker);
    } finally {
      try {
        if (locked && lockClient) {
          const [release, ...extra] =
            await lockClient.unsafe(GLOBAL_UNLOCK_SQL);
          if (release?.released !== true || extra.length !== 0) {
            throw new Error("Greenfield TEST target lock was not released");
          }
        }
      } finally {
        try {
          if (lockClient) await lockClient.release();
        } finally {
          await endClient(lockPool);
        }
      }
    }
  }
}

async function runtimeRoleState(sql) {
  const [state, ...extra] = await sql.unsafe(RUNTIME_ROLE_STATE_SQL);
  if (!state || extra.length !== 0) {
    throw new Error("Greenfield TEST runtime role state is invalid");
  }
  return state;
}

async function assertRuntimeRoleRestored(sql) {
  const state = await runtimeRoleState(sql);
  if (state.rolcanlogin || state.has_unsafe_membership) {
    throw new Error("Greenfield TEST runtime role was not restored");
  }
}

async function terminateRuntimeSessions(sql) {
  const terminated = await sql.unsafe(RUNTIME_SESSION_TERMINATE_SQL);
  if (terminated.some((row) => row.terminated !== true)) {
    throw new Error("Greenfield TEST runtime sessions could not be terminated");
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [state, ...extra] = await sql.unsafe(RUNTIME_SESSION_STATE_SQL);
    if (!state || extra.length !== 0) {
      throw new Error("Greenfield TEST runtime session state is invalid");
    }
    if (Number(state.active) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Greenfield TEST runtime sessions remain active");
}

async function cleanupRuntimeRole(sql) {
  await terminateRuntimeSessions(sql);
  await sql.unsafe(RUNTIME_ROLE_DISABLE_SQL);
  await sql.unsafe(RUNTIME_ROLE_REVOKE_SQL);
  await assertRuntimeRoleRestored(sql);
  await terminateRuntimeSessions(sql);
}

async function restoreRuntimeRole(primary, fallback) {
  try {
    await cleanupRuntimeRole(primary);
  } catch {
    await fallback();
  }
}

function runtimePassword() {
  return `Aa9!${randomBytes(32).toString("base64url")}`;
}

export async function withTemporaryRuntimeRole({
  config,
  worker,
  recoverRuntimeRole,
  callback,
  passwordFactory = runtimePassword,
}) {
  if (
    typeof callback !== "function" ||
    typeof recoverRuntimeRole !== "function"
  ) {
    throw new Error("Greenfield TEST runtime role requires a callback");
  }
  await restoreRuntimeRole(worker, recoverRuntimeRole);
  const password = passwordFactory();
  const runtimeDatabaseUrl = config.deriveAppRuntimeDatabaseUrl(password);
  try {
    await worker.begin(async (transaction) => {
      await transaction.unsafe(RUNTIME_PASSWORD_CONFIG_SQL, [password]);
      await transaction.unsafe(RUNTIME_ROLE_GRANT_SQL);
      await transaction.unsafe(RUNTIME_ROLE_ALTER_SQL);
    });
    return await callback({ runtimeDatabaseUrl });
  } finally {
    await restoreRuntimeRole(worker, recoverRuntimeRole);
  }
}
