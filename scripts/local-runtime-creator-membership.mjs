export const RUNTIME_CREATOR_MEMBERSHIP_SQL = `
  select grantor.rolname as grantor, membership.admin_option,
    membership.inherit_option, membership.set_option
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles granted on granted.oid = membership.roleid
  join pg_catalog.pg_roles member on member.oid = membership.member
  join pg_catalog.pg_roles grantor on grantor.oid = membership.grantor
  where granted.rolname = 'app_runtime'
    and member.rolname = 'postgres'
  order by grantor.rolname
`;

function exactRuntimeCreatorMembership(rows) {
  if (!Array.isArray(rows) || rows.length > 1) {
    throw new Error("Local runtime creator membership snapshot is invalid");
  }
  if (
    rows.length === 1 &&
    !(
      rows[0].grantor === "supabase_admin" &&
      rows[0].admin_option === true &&
      rows[0].inherit_option === false &&
      rows[0].set_option === false
    )
  ) {
    throw new Error("Local runtime found unexpected creator membership");
  }
  return JSON.stringify(rows);
}

export async function withLocalRuntimeCreatorMembership(admin, callback) {
  if (
    !admin ||
    typeof admin.unsafe !== "function" ||
    typeof callback !== "function"
  ) {
    throw new Error("Local runtime creator membership lifecycle is invalid");
  }
  const beforeRows = await admin.unsafe(RUNTIME_CREATOR_MEMBERSHIP_SQL);
  const before = exactRuntimeCreatorMembership(beforeRows);
  const temporary = beforeRows.length === 0;
  let operationError;
  let result;
  try {
    await admin.unsafe(
      temporary
        ? "grant app_runtime to postgres with admin false, inherit false, set true granted by current_user"
        : "grant app_runtime to postgres with admin true, inherit false, set true granted by current_user",
    );
    result = await callback();
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = [];
  try {
    await admin.unsafe(
      temporary
        ? "revoke app_runtime from postgres granted by current_user"
        : "grant app_runtime to postgres with admin true, inherit false, set false granted by current_user",
    );
  } catch {
    cleanupErrors.push(
      new Error("Local runtime creator membership was not restored"),
    );
  }
  try {
    const after = exactRuntimeCreatorMembership(
      await admin.unsafe(RUNTIME_CREATOR_MEMBERSHIP_SQL),
    );
    if (after !== before) {
      cleanupErrors.push(
        new Error("Local runtime did not restore creator membership exactly"),
      );
    }
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (operationError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      "Local runtime operation and creator membership cleanup failed",
    );
  }
  if (operationError) throw operationError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(
      cleanupErrors,
      "Local runtime creator membership cleanup failed",
    );
  }
  return result;
}
