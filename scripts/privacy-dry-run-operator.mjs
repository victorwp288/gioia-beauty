const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TEST_TARGET_REF = "hzibzwhrwmljgjjdzspi";
const TEST_POOLER_HOST = "aws-1-eu-central-2.pooler.supabase.com";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POLICY_VERSION = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const STORES = Object.freeze([
  "command_requests",
  "domain_change_log",
  "email_outbox",
  "email_webhook_events",
  "migration_evidence",
  "newsletter_subscribers",
  "owner_auth",
  "schedule_entries",
]);

export class PrivacyDryRunOperatorError extends Error {
  constructor(code) {
    super(code);
    this.name = "PrivacyDryRunOperatorError";
    this.code = code;
  }
}

function databaseUrlFrom(getDatabaseUrl) {
  if (typeof getDatabaseUrl !== "function") {
    throw new PrivacyDryRunOperatorError("PRIVACY_DATABASE_GETTER_REQUIRED");
  }
  try {
    return new URL(getDatabaseUrl());
  } catch {
    throw new PrivacyDryRunOperatorError("PRIVACY_DATABASE_TARGET_INVALID");
  }
}

function validDatabase(url) {
  return (
    ["postgres:", "postgresql:"].includes(url.protocol) &&
    Boolean(url.password) &&
    url.pathname === "/postgres" &&
    !url.hash
  );
}

export function parsePrivacyDryRunEnvironment(env, { getDatabaseUrl } = {}) {
  const mode = env.PRIVACY_OPERATOR_MODE ?? "dry-run";
  if (mode !== "dry-run") {
    throw new PrivacyDryRunOperatorError("PRIVACY_DRY_RUN_ONLY");
  }
  const url = databaseUrlFrom(getDatabaseUrl);
  if (!validDatabase(url)) {
    throw new PrivacyDryRunOperatorError("PRIVACY_DATABASE_TARGET_INVALID");
  }
  if (env.APP_ENV === "local" || env.APP_ENV === "test") {
    if (
      !LOOPBACK_HOSTS.has(url.hostname) ||
      decodeURIComponent(url.username) !== "postgres" ||
      url.search !== ""
    ) {
      throw new PrivacyDryRunOperatorError("PRIVACY_LOOPBACK_TARGET_REQUIRED");
    }
    return Object.freeze({
      mode,
      environment: env.APP_ENV,
      targetId:
        env.APP_ENV === "local" ? "gioia-beauty-local" : "gioia-beauty-test",
    });
  }
  if (
    env.APP_ENV !== "operator" ||
    env.SUPABASE_PROJECT_REF !== TEST_TARGET_REF ||
    url.hostname !== TEST_POOLER_HOST ||
    url.port !== "5432" ||
    decodeURIComponent(url.username) !== `postgres.${TEST_TARGET_REF}` ||
    url.searchParams.size !== 1 ||
    url.searchParams.get("sslmode") !== "verify-full"
  ) {
    throw new PrivacyDryRunOperatorError("PRIVACY_TEST_TARGET_REQUIRED");
  }
  return Object.freeze({
    mode,
    environment: "test",
    targetId: TEST_TARGET_REF,
  });
}

function bytes32(value, code) {
  if (!Buffer.isBuffer(value) || value.byteLength !== 32) {
    throw new PrivacyDryRunOperatorError(code);
  }
  return Buffer.from(value);
}

function uuid(value, code, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new PrivacyDryRunOperatorError(code);
  }
  return value;
}

function policyVersion(value) {
  if (typeof value !== "string" || !POLICY_VERSION.test(value)) {
    throw new PrivacyDryRunOperatorError("PRIVACY_POLICY_VERSION_INVALID");
  }
  return value;
}

function canonicalInstant(value) {
  let canonical = null;
  try {
    canonical =
      typeof value === "string" ? new Date(value).toISOString() : null;
  } catch {
    // The fixed error below is the only public result for invalid evidence time.
  }
  if (canonical !== value) {
    throw new PrivacyDryRunOperatorError("PRIVACY_IDENTITY_EVIDENCE_INVALID");
  }
  return value;
}

function optionalExact(value, minimum, maximum, code) {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new PrivacyDryRunOperatorError(code);
  }
  return value;
}

function inventoryRows(value, maximum) {
  if (!Array.isArray(value) || value.length !== STORES.length) {
    throw new PrivacyDryRunOperatorError("PRIVACY_INVENTORY_RESULT_INVALID");
  }
  const rows = value.map((row) => {
    const keys = Object.keys(row ?? {})
      .sort()
      .join(",");
    if (
      keys !== "capped,matched_rows,store_name" ||
      !STORES.includes(row.store_name) ||
      !Number.isInteger(row.matched_rows) ||
      row.matched_rows < 0 ||
      row.matched_rows > maximum ||
      typeof row.capped !== "boolean"
    ) {
      throw new PrivacyDryRunOperatorError("PRIVACY_INVENTORY_RESULT_INVALID");
    }
    return Object.freeze({
      store: row.store_name,
      rows: row.matched_rows,
      capped: row.capped,
    });
  });
  if (new Set(rows.map(({ store }) => store)).size !== STORES.length) {
    throw new PrivacyDryRunOperatorError("PRIVACY_INVENTORY_RESULT_INVALID");
  }
  return Object.freeze(
    rows.sort((left, right) => left.store.localeCompare(right.store)),
  );
}

function scrubPlanRows(value) {
  if (!Array.isArray(value) || value.length !== STORES.length) {
    throw new PrivacyDryRunOperatorError("PRIVACY_SCRUB_PLAN_RESULT_INVALID");
  }
  const rows = value.map((row) => {
    const keys = Object.keys(row ?? {})
      .sort()
      .join(",");
    if (
      keys !== "decision_ids,field_codes,matched_rows,store_name" ||
      !STORES.includes(row.store_name) ||
      !Number.isInteger(row.matched_rows) ||
      row.matched_rows < 0 ||
      row.matched_rows > 100 ||
      !Array.isArray(row.field_codes) ||
      !Array.isArray(row.decision_ids) ||
      row.field_codes.length < 1 ||
      row.field_codes.length > 16 ||
      row.decision_ids.length < 1 ||
      row.decision_ids.length > 8 ||
      row.field_codes.some(
        (value) =>
          typeof value !== "string" || !/^[a-z][a-z0-9_]{0,62}$/u.test(value),
      ) ||
      row.decision_ids.some(
        (value) =>
          typeof value !== "string" ||
          !/^RET-(?:0[1-9]|1[0-7]|HOLD)$/u.test(value),
      )
    ) {
      throw new PrivacyDryRunOperatorError("PRIVACY_SCRUB_PLAN_RESULT_INVALID");
    }
    return Object.freeze({
      store: row.store_name,
      rows: row.matched_rows,
      fieldCodes: Object.freeze([...row.field_codes]),
      decisionIds: Object.freeze([...row.decision_ids]),
    });
  });
  if (new Set(rows.map(({ store }) => store)).size !== STORES.length) {
    throw new PrivacyDryRunOperatorError("PRIVACY_SCRUB_PLAN_RESULT_INVALID");
  }
  return Object.freeze(
    rows.sort((left, right) => left.store.localeCompare(right.store)),
  );
}

export function createPrivacyDryRunOperator({
  database,
  env = process.env,
  getDatabaseUrl,
}) {
  const target = parsePrivacyDryRunEnvironment(env, { getDatabaseUrl });
  if (!database || typeof database.unsafe !== "function") {
    throw new PrivacyDryRunOperatorError("PRIVACY_DATABASE_CLIENT_REQUIRED");
  }
  return Object.freeze({
    mode: "dry-run",
    async inventory(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new PrivacyDryRunOperatorError("PRIVACY_INVENTORY_INPUT_INVALID");
      }
      const maximum = input.maxRowsPerStore ?? 100;
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) {
        throw new PrivacyDryRunOperatorError("PRIVACY_INVENTORY_BOUND_INVALID");
      }
      if (!new Set(["access", "erasure"]).has(input.requestKind)) {
        throw new PrivacyDryRunOperatorError("PRIVACY_REQUEST_KIND_INVALID");
      }
      const email = optionalExact(
        input.normalizedEmail ?? null,
        3,
        320,
        "PRIVACY_EMAIL_INVALID",
      );
      if (email !== null && email !== email.toLowerCase()) {
        throw new PrivacyDryRunOperatorError("PRIVACY_EMAIL_INVALID");
      }
      const phone = optionalExact(
        input.clientPhone ?? null,
        1,
        40,
        "PRIVACY_PHONE_INVALID",
      );
      const scheduleId = uuid(
        input.scheduleEntryId ?? null,
        "PRIVACY_SCHEDULE_ID_INVALID",
        true,
      );
      if (
        [email, phone, scheduleId].filter((value) => value !== null).length < 1
      ) {
        throw new PrivacyDryRunOperatorError("PRIVACY_SELECTOR_REQUIRED");
      }
      const rows = await database.unsafe(
        `select store_name, matched_rows, capped
         from gioia_private.inventory_privacy_subject_dry_run(
           $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,
           $8::uuid,$9::bytea,$10::bytea,$11::timestamptz,$12::smallint
         )`,
        [
          uuid(input.caseId, "PRIVACY_CASE_ID_INVALID"),
          policyVersion(input.policyVersion),
          target.environment,
          target.targetId,
          input.requestKind,
          email,
          phone,
          scheduleId,
          bytes32(
            input.selectorManifestSha256,
            "PRIVACY_SELECTOR_EVIDENCE_INVALID",
          ),
          bytes32(
            input.identityEvidenceSha256,
            "PRIVACY_IDENTITY_EVIDENCE_INVALID",
          ),
          canonicalInstant(input.identityVerifiedAt),
          maximum,
        ],
      );
      return Object.freeze({
        mode: "dry-run",
        inventory: inventoryRows(rows, maximum),
      });
    },
    async planScrub(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new PrivacyDryRunOperatorError(
          "PRIVACY_SCRUB_PLAN_INPUT_INVALID",
        );
      }
      const { caseId, maxTotalRows = 10_000 } = input;
      if (
        !Number.isInteger(maxTotalRows) ||
        maxTotalRows < 1 ||
        maxTotalRows > 10_000
      ) {
        throw new PrivacyDryRunOperatorError(
          "PRIVACY_SCRUB_PLAN_BOUND_INVALID",
        );
      }
      const rows = await database.unsafe(
        `select store_name, matched_rows, field_codes, decision_ids
         from gioia_private.plan_privacy_scrub_dry_run($1::uuid,$2::integer)`,
        [uuid(caseId, "PRIVACY_CASE_ID_INVALID"), maxTotalRows],
      );
      return Object.freeze({ mode: "dry-run", plan: scrubPlanRows(rows) });
    },
  });
}
