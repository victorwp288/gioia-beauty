import { createHmac } from "node:crypto";

import {
  LOCAL_PHASE3_E2E_BOOKING_HMAC_SECRET,
  LOCAL_PHASE4_OWNER_LOGIN_NETWORK,
  LOCAL_SYNTHETIC_OWNER,
} from "./local-phase3-e2e-contract.mjs";

const MAX_EXACT_BUCKET_ROWS = 2;
const DELETE_EXACT_BUCKETS_SQL = `
  with exact_rows as materialized (
    select bucket.action, bucket.scope_kind, bucket.hmac_key_id,
      bucket.scope_hash, bucket.bucket_start
    from gioia_private.public_abuse_buckets as bucket
    where bucket.action = 'owner_login'
      and bucket.hmac_key_id = 'public_v1'
      and (
        (bucket.scope_kind = 'network' and bucket.scope_hash = $1::bytea)
        or (bucket.scope_kind = 'account' and bucket.scope_hash = $2::bytea)
      )
    order by bucket.scope_kind, bucket.bucket_start
    limit $3::integer
    for update
  )
  delete from gioia_private.public_abuse_buckets as bucket
  using exact_rows
  where (bucket.action, bucket.scope_kind, bucket.hmac_key_id,
    bucket.scope_hash, bucket.bucket_start) =
    (exact_rows.action, exact_rows.scope_kind, exact_rows.hmac_key_id,
     exact_rows.scope_hash, exact_rows.bucket_start)
  returning bucket.action, bucket.scope_kind, bucket.hmac_key_id,
    bucket.scope_hash
`;
const ASSERT_ZERO_EXACT_BUCKETS_SQL = `
  select bucket.scope_kind
  from gioia_private.public_abuse_buckets as bucket
  where bucket.action = 'owner_login'
    and bucket.hmac_key_id = 'public_v1'
    and (
      (bucket.scope_kind = 'network' and bucket.scope_hash = $1::bytea)
      or (bucket.scope_kind = 'account' and bucket.scope_hash = $2::bytea)
    )
  limit 1
`;

function networkHash() {
  return createHmac("sha256", LOCAL_PHASE3_E2E_BOOKING_HMAC_SECRET)
    .update("gioia:public-principal:v1\0", "utf8")
    .update(`network:${LOCAL_PHASE4_OWNER_LOGIN_NETWORK}`, "utf8")
    .digest();
}

function accountHash() {
  return createHmac("sha256", LOCAL_PHASE3_E2E_BOOKING_HMAC_SECRET)
    .update("gioia:public-abuse-scope:v1\0", "utf8")
    .update(`account:${LOCAL_SYNTHETIC_OWNER.email}`, "utf8")
    .digest();
}

function exactDeletedRows(rows, expectedHashes) {
  if (!Array.isArray(rows) || rows.length > MAX_EXACT_BUCKET_ROWS) return false;
  const seen = new Set();
  for (const row of rows) {
    const expected = expectedHashes.get(row?.scope_kind);
    if (
      row?.action !== "owner_login" ||
      row?.hmac_key_id !== "public_v1" ||
      !Buffer.isBuffer(row?.scope_hash) ||
      !expected ||
      !row.scope_hash.equals(expected) ||
      seen.has(row.scope_kind)
    ) {
      return false;
    }
    seen.add(row.scope_kind);
  }
  return true;
}

export async function clearLocalPhase4OwnerLoginAbuse(database) {
  if (!database || typeof database.begin !== "function") {
    throw new Error("Local owner abuse isolation requires a database");
  }
  const expectedHashes = new Map([
    ["network", networkHash()],
    ["account", accountHash()],
  ]);
  await database.begin(async (transaction) => {
    await transaction.unsafe("set local lock_timeout = '5s'");
    await transaction.unsafe("set local statement_timeout = '15s'");
    const parameters = [
      expectedHashes.get("network"),
      expectedHashes.get("account"),
    ];
    const deleted = await transaction.unsafe(DELETE_EXACT_BUCKETS_SQL, [
      ...parameters,
      MAX_EXACT_BUCKET_ROWS + 1,
    ]);
    if (!exactDeletedRows(deleted, expectedHashes)) {
      throw new Error("Unexpected Local owner abuse fixture residue");
    }
    const residue = await transaction.unsafe(
      ASSERT_ZERO_EXACT_BUCKETS_SQL,
      parameters,
    );
    if (!Array.isArray(residue) || residue.length !== 0) {
      throw new Error("Local owner abuse fixture residue was not isolated");
    }
  });
}
