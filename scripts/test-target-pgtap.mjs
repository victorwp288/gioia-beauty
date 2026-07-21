import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

import { REVIEWED_REMOTE_PGTAP_DIGESTS } from "./test-target-reviewed-manifest.mjs";
import { remotePgTapFiles } from "./test-target-migrations.mjs";

const TEST_TARGET_REF = "hzibzwhrwmljgjjdzspi";
const TEST_TARGET_POOLER = /^aws-1-eu-central-2\.pooler\.supabase\.com$/u;
const TEST_TARGET_CA_FINGERPRINT =
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";

export class TestTargetPgTapError extends Error {
  constructor(message) {
    super(message);
    this.name = "TestTargetPgTapError";
  }
}

export const REMOTE_PGTAP_ROLLBACK_SQL = "rollback";
export const REMOTE_PGTAP_CLEANUP_SQL = "drop extension if exists pgtap";
export const REMOTE_PGTAP_SETUP_SQL =
  "create extension if not exists pgtap with schema extensions";
export const REMOTE_PGTAP_STATEMENT_TIMESTAMP_BOUNDARY =
  "-- gioia-remote-pgtap-statement-timestamp-boundary";
export const REMOTE_PGTAP_STATEMENT_TIMESTAMP_DELAY_MS = 5;
const REMOTE_PGTAP_STATEMENT_TIMESTAMP_FILES = new Set([
  "080_subscriber_commands.test.sql",
  "100_verified_webhook_commands.test.sql",
]);
export const REMOTE_PGTAP_NEWSLETTER_FIXTURE_FILES = Object.freeze([
  "080_subscriber_commands.test.sql",
  "100_verified_webhook_commands.test.sql",
  "135_consent_evidence_binding.test.sql",
]);
export const REMOTE_PGTAP_NEWSLETTER_FIXTURE_SQL = `
insert into gioia_private.newsletter_consent_artifacts (
  artifact_version, policy_version, locale, form_copy, confirmation_copy,
  privacy_notice_url, content_sha256, effective_at
) values (
  'newsletter-consent-v1.it-1', 'newsletter-consent-v1', 'it-IT',
  'Synthetic local newsletter consent fixture.',
  'Synthetic local newsletter confirmation fixture.',
  'https://www.gioiabeauty.net/policy', decode(repeat('a1', 32), 'hex'),
  '2026-01-01 00:00:00+00'
) on conflict (artifact_version) do nothing;

insert into gioia_private.newsletter_action_signing_keys (
  key_id, issue_enabled, verify_until, created_at
) values (
  'local_1', true, '2099-01-01 00:00:00+00', '2026-01-01 00:00:00+00'
) on conflict (key_id) do update set
  issue_enabled = excluded.issue_enabled,
  verify_until = excluded.verify_until;
`;
const REMOTE_PGTAP_SETUP_FILE = "000_0_pgtap_setup.test.sql";
const REMOTE_PGTAP_SETUP_PREFIX = `${REMOTE_PGTAP_SETUP_SQL};\n\n`;
const NEWSLETTER_FIXTURE_FILES = new Set(REMOTE_PGTAP_NEWSLETTER_FIXTURE_FILES);
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function validatedDatabaseUrl(getter) {
  if (typeof getter !== "function") {
    throw new TestTargetPgTapError(
      "TEST pgTAP database URL must use a private getter",
    );
  }
  try {
    const url = new URL(getter());
    if (
      url.protocol !== "postgresql:" ||
      decodeURIComponent(url.username) !== `postgres.${TEST_TARGET_REF}` ||
      !url.password ||
      !TEST_TARGET_POOLER.test(url.hostname) ||
      url.port !== "5432" ||
      url.pathname !== "/postgres" ||
      url.hash ||
      url.searchParams.size !== 1 ||
      url.searchParams.get("sslmode") !== "verify-full"
    ) {
      throw new Error();
    }
    return url.href;
  } catch {
    throw new TestTargetPgTapError(
      "TEST pgTAP database URL is not the exact TEST session pooler",
    );
  }
}

function validatedCertificate(getter) {
  if (typeof getter !== "function") {
    throw new TestTargetPgTapError(
      "TEST pgTAP CA certificate must use a private getter",
    );
  }
  try {
    const source = getter();
    const certificate = new X509Certificate(source);
    if (
      typeof source !== "string" ||
      !certificate.ca ||
      source !== certificate.toString() ||
      certificate.fingerprint256 !== TEST_TARGET_CA_FINGERPRINT ||
      Date.parse(certificate.validFrom) > Date.now() ||
      Date.parse(certificate.validTo) <= Date.now()
    ) {
      throw new Error();
    }
    return source;
  } catch {
    throw new TestTargetPgTapError("TEST pgTAP CA certificate is invalid");
  }
}

function textRows(results) {
  if (!Array.isArray(results) || !results.every(Array.isArray)) {
    throw new TestTargetPgTapError("Remote pgTAP result shape is invalid");
  }
  return results.flatMap((rows) =>
    rows.flatMap((row) =>
      row && typeof row === "object" && !Array.isArray(row)
        ? Object.values(row).filter((value) => typeof value === "string")
        : [],
    ),
  );
}

function expectedAssertions(source) {
  const matches = [...source.matchAll(/select plan\((\d+)\);/gu)];
  if (matches.length !== 1) {
    throw new TestTargetPgTapError("Remote pgTAP plan is invalid");
  }
  return Number(matches[0][1]);
}

function reviewedSource(file, absoluteFile) {
  const source = readFileSync(absoluteFile);
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest !== REVIEWED_REMOTE_PGTAP_DIGESTS[path.basename(file)]) {
    throw new TestTargetPgTapError("Remote pgTAP source is not reviewed");
  }
  return source.toString("utf8");
}

export function withRemotePgTapFixtures(file, source) {
  if (!NEWSLETTER_FIXTURE_FILES.has(path.basename(file))) return source;
  const transactionPrefix = "begin;\n";
  if (!source.startsWith(transactionPrefix)) {
    throw new TestTargetPgTapError(
      "Remote pgTAP newsletter fixture transaction is invalid",
    );
  }
  return `${transactionPrefix}${REMOTE_PGTAP_NEWSLETTER_FIXTURE_SQL}${source.slice(transactionPrefix.length)}`;
}

export function remotePgTapQuerySegments(file, source) {
  const basename = path.basename(file);
  const segments = source.split(REMOTE_PGTAP_STATEMENT_TIMESTAMP_BOUNDARY);
  const requiresBoundary = REMOTE_PGTAP_STATEMENT_TIMESTAMP_FILES.has(basename);
  if (
    (requiresBoundary && segments.length !== 2) ||
    (!requiresBoundary && segments.length !== 1) ||
    segments.some((segment) => segment.trim().length === 0)
  ) {
    throw new TestTargetPgTapError(
      "Remote pgTAP statement timestamp boundary is invalid",
    );
  }
  return Object.freeze(segments);
}

function validateTapResult(file, source, results) {
  const expected = expectedAssertions(source);
  const lines = textRows(results);
  const plans = lines.filter((line) => /^1\.\.\d+$/u.test(line));
  const successes = lines.filter((line) => /^ok \d+\b/u.test(line));
  const failed = lines.some((line) => {
    const marker = line.trimStart();
    return /^not ok\b/iu.test(marker) || /^Bail out!/iu.test(marker);
  });
  if (
    plans.length !== 1 ||
    plans[0] !== `1..${expected}` ||
    successes.length !== expected ||
    failed ||
    successes.some((line, index) => !line.startsWith(`ok ${index + 1} `))
  ) {
    throw new TestTargetPgTapError(`Remote pgTAP result failed for ${file}`);
  }
  return expected;
}

export function createRemotePgTapRunner({
  databaseClient = postgres,
  getDatabaseCaCertificate,
  getOperatorSessionDatabaseUrl,
  queryBoundaryWait = wait,
  rootDirectory = process.cwd(),
} = {}) {
  if (typeof databaseClient !== "function") {
    throw new TestTargetPgTapError("TEST pgTAP database client is invalid");
  }
  if (typeof queryBoundaryWait !== "function") {
    throw new TestTargetPgTapError(
      "TEST pgTAP statement timestamp wait is invalid",
    );
  }
  const databaseUrl = validatedDatabaseUrl(getOperatorSessionDatabaseUrl);
  const caCertificate = validatedCertificate(getDatabaseCaCertificate);
  const root = path.resolve(rootDirectory);

  return async function runRemotePgTap() {
    const suite = remotePgTapFiles(root);
    let sql;
    let total = 0;
    let result;
    let operationError;
    try {
      sql = databaseClient(databaseUrl, {
        prepare: false,
        ssl: { ca: caCertificate, rejectUnauthorized: true },
        max: 1,
        idle_timeout: 5,
        connect_timeout: 10,
        max_lifetime: 60,
        onnotice: () => {},
        connection: { application_name: "gioia_test_operator_pgtap" },
      });
      for (const file of suite.files) {
        const absoluteFile = path.join(root, file);
        const source = reviewedSource(file, absoluteFile);
        let testSource = source;
        if (path.basename(file) === REMOTE_PGTAP_SETUP_FILE) {
          if (!source.startsWith(REMOTE_PGTAP_SETUP_PREFIX)) {
            throw new TestTargetPgTapError(
              "Remote pgTAP setup source is invalid",
            );
          }
          await sql.unsafe(REMOTE_PGTAP_SETUP_SQL);
          testSource = source.slice(REMOTE_PGTAP_SETUP_PREFIX.length);
        }
        testSource = withRemotePgTapFixtures(file, testSource);
        const results = [];
        const segments = remotePgTapQuerySegments(file, testSource);
        for (const [index, segment] of segments.entries()) {
          if (index > 0) {
            // Newsletter evidence is canonicalized to milliseconds. The hosted
            // runner compresses separate user actions into one transaction, so
            // keep the second query message beyond that precision boundary.
            await queryBoundaryWait(REMOTE_PGTAP_STATEMENT_TIMESTAMP_DELAY_MS);
          }
          const segmentResults = await sql.unsafe(segment, [], {
            simple: true,
          });
          if (!Array.isArray(segmentResults)) {
            throw new TestTargetPgTapError(
              "Remote pgTAP result shape is invalid",
            );
          }
          results.push(...segmentResults);
        }
        total += validateTapResult(file, source, results);
      }
      if (total !== suite.assertions) {
        throw new TestTargetPgTapError(
          "Remote pgTAP assertion total is invalid",
        );
      }
      result = Object.freeze({ ...suite });
    } catch (error) {
      operationError =
        error instanceof TestTargetPgTapError
          ? error
          : new TestTargetPgTapError("Remote pgTAP execution failed");
    }

    let cleanupError;
    if (sql) {
      for (const cleanup of [
        () => sql.unsafe(REMOTE_PGTAP_ROLLBACK_SQL),
        () => sql.unsafe(REMOTE_PGTAP_CLEANUP_SQL),
        () => sql.end({ timeout: 5 }),
      ]) {
        try {
          await cleanup();
        } catch {
          cleanupError ??= new TestTargetPgTapError(
            "Remote pgTAP cleanup failed",
          );
        }
      }
    }
    if (operationError && cleanupError) {
      throw new AggregateError(
        [operationError, cleanupError],
        "Remote pgTAP execution and cleanup failed",
      );
    }
    if (operationError) throw operationError;
    if (cleanupError) throw cleanupError;
    return result;
  };
}
