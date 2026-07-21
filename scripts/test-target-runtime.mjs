import { randomBytes } from "node:crypto";

import postgres from "postgres";

import { DATABASE_POOL_SIZE } from "./concurrency-harness.mjs";
import { GREENFIELD_TEST_OWNER } from "./test-target-fixture-sql.mjs";

const OWNER_LEDGER_SQL = `
  select count(*)::integer as total,
    count(*) filter (where revoked_at is not null)::integer as revoked,
    count(*) filter (
      where revoked_at is null and expires_at > clock_timestamp()
    )::integer as active
  from gioia_private.owner_sessions
  where user_id = $1::uuid
`;

export const GREENFIELD_OWNER_COOKIE_SECURITY = Object.freeze({
  session: Object.freeze({
    required: Object.freeze([
      "httponly",
      "path=/",
      "samesite=strict",
      "max-age=43200",
    ]),
    forbidden: Object.freeze(["secure"]),
  }),
  csrf: Object.freeze({
    required: Object.freeze(["path=/", "samesite=strict", "max-age=43200"]),
    forbidden: Object.freeze(["httponly", "secure"]),
  }),
  supabase: Object.freeze({
    namePrefix: "sb-hzibzwhrwmljgjjdzspi-auth-token",
    required: Object.freeze(["httponly", "path=/", "samesite=lax", "secure"]),
    forbidden: Object.freeze([]),
  }),
});

export const GREENFIELD_OWNER_LEDGER_SQL = OWNER_LEDGER_SQL;

export function createGreenfieldOwnerPassword(randomBytesImpl = randomBytes) {
  const entropy = randomBytesImpl(32);
  if (!Buffer.isBuffer(entropy) || entropy.byteLength !== 32) {
    throw new Error("Greenfield TEST owner entropy is invalid");
  }
  return `Aa9!${entropy.toString("base64url")}`;
}

export async function reconcileGreenfieldOwnerLedger(sql) {
  const [row, ...extra] = await sql.unsafe(OWNER_LEDGER_SQL, [
    GREENFIELD_TEST_OWNER.id,
  ]);
  if (
    !row ||
    extra.length !== 0 ||
    Number(row.total) !== 1 ||
    Number(row.revoked) !== 1 ||
    Number(row.active) !== 0
  ) {
    throw new Error("Greenfield TEST owner session ledger did not reconcile");
  }
}

export async function withGreenfieldRuntimeDatabase(
  databaseUrl,
  callback,
  { caCertificate, clientFactory = postgres } = {},
) {
  if (typeof callback !== "function") {
    throw new Error("Greenfield TEST runtime database requires a callback");
  }
  if (typeof caCertificate !== "string" || caCertificate.length === 0) {
    throw new Error("Greenfield TEST runtime database CA is invalid");
  }
  const sql = clientFactory(databaseUrl, {
    prepare: false,
    ssl: { ca: caCertificate, rejectUnauthorized: true },
    max: DATABASE_POOL_SIZE,
    idle_timeout: 5,
    connect_timeout: 10,
    max_lifetime: 60,
    onnotice: () => {},
    connection: { application_name: "gioia_public_api" },
  });
  try {
    return await callback(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
