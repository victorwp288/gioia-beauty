import postgres from "postgres";

import { getLocalRouteStatus } from "../../scripts/local-owner-auth-harness.mjs";

export async function runtimeMembership(command: string) {
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
    await sql.unsafe(command);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export default async function phase3GlobalSetup() {
  await runtimeMembership(
    "grant app_runtime to postgres with inherit false, set true granted by current_user",
  );
}
