import { fileURLToPath } from "node:url";

import {
  parseTestTargetConfig,
  TEST_TARGET_API_URL,
  TEST_TARGET_REF,
  TestTargetConfigError,
} from "./test-target-config.mjs";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 32 * 1024;
const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{20,}$/;
const OPENAPI_DENIAL_STATUSES = new Set([401, 403]);
const PUBLIC_RESOURCE_DENIAL_STATUSES = new Set([404]);
const PRIVATE_RESOURCE_DENIAL_STATUSES = new Set([404, 406]);
const PRIVATE_SCHEMA = "gioia_private";
const PRIVATE_OBJECT_NAMES = new Set([
  "booking_policy",
  "business_hours",
  "command_requests",
  "domain_change_log",
  "email_outbox",
  "email_webhook_events",
  "migration_quarantine",
  "migration_records",
  "migration_runs",
  "newsletter_subscribers",
  "owner_accounts",
  "owner_sessions",
  "schedule_day_locks",
  "schedule_entries",
  "service_categories",
  "service_variants",
  "services",
  "vacations",
]);
const SENSITIVE_RESPONSE_PATTERNS = Object.freeze([
  /\bsb_secret_[A-Za-z0-9_-]+\b/u,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /\bpostgres(?:ql)?:\/\/[^\s"']+/iu,
  /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/u,
]);

const AVAILABILITY_QUERY = new URLSearchParams({
  p_local_date: "2099-01-05",
  p_service_id: "synthetic-service",
  p_variant_id: "synthetic-variant",
}).toString();

const PROBES = Object.freeze([
  Object.freeze({
    name: "openapi",
    path: "/rest/v1/",
    accept: "application/openapi+json, application/json",
    kind: "openapi",
  }),
  Object.freeze({
    name: "public-customer-table",
    path: "/rest/v1/schedule_entries?select=id&limit=1",
    allowedStatuses: PUBLIC_RESOURCE_DENIAL_STATUSES,
  }),
  Object.freeze({
    name: "public-business-table",
    path: "/rest/v1/services?select=id&limit=1",
    allowedStatuses: PUBLIC_RESOURCE_DENIAL_STATUSES,
  }),
  Object.freeze({
    name: "private-customer-table",
    path: "/rest/v1/schedule_entries?select=id&limit=1",
    profile: PRIVATE_SCHEMA,
    allowedStatuses: PRIVATE_RESOURCE_DENIAL_STATUSES,
  }),
  Object.freeze({
    name: "public-private-rpc",
    path: `/rest/v1/rpc/get_public_availability?${AVAILABILITY_QUERY}`,
    allowedStatuses: PUBLIC_RESOURCE_DENIAL_STATUSES,
  }),
  Object.freeze({
    name: "private-rpc",
    path: `/rest/v1/rpc/get_public_availability?${AVAILABILITY_QUERY}`,
    profile: PRIVATE_SCHEMA,
    allowedStatuses: PRIVATE_RESOURCE_DENIAL_STATUSES,
  }),
]);

export class TestTargetDataApiError extends Error {
  constructor(code, probe, status) {
    super(`TEST Data API boundary verification failed (${code})`);
    this.name = "TestTargetDataApiError";
    this.code = code;
    this.probe = probe;
    if (Number.isInteger(status)) this.status = status;
  }
}

function failure(code, probe, status) {
  return new TestTargetDataApiError(code, probe, status);
}

function validateInputs(config, fetchImpl, timeoutMs) {
  if (
    config?.environment !== "test" ||
    config.projectRef !== TEST_TARGET_REF ||
    config.apiUrl !== `${TEST_TARGET_API_URL}/` ||
    typeof config.getPublishableKey !== "function"
  ) {
    throw failure("UNSAFE_TARGET", "configuration");
  }
  if (typeof fetchImpl !== "function") {
    throw failure("INVALID_FETCH", "configuration");
  }
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw failure("INVALID_TIMEOUT", "configuration");
  }

  const key = config.getPublishableKey();
  if (!PUBLISHABLE_KEY_PATTERN.test(key ?? "")) {
    throw failure("INVALID_PUBLIC_KEY", "configuration");
  }
  return key;
}

async function cancelReader(reader) {
  try {
    await reader.cancel();
  } catch {
    // The response is already rejected; cancellation is best effort.
  }
}

async function readBoundedText(response, probeName) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw failure("RESPONSE_TOO_LARGE", probeName, response.status);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await cancelReader(reader);
        throw failure("RESPONSE_TOO_LARGE", probeName, response.status);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function assertNoSensitiveResponse(text, key, probeName, status) {
  if (
    text.includes(key) ||
    SENSITIVE_RESPONSE_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    throw failure("SENSITIVE_RESPONSE", probeName, status);
  }
}

function schemaNames(document) {
  const names = [];
  if (document.definitions && typeof document.definitions === "object") {
    names.push(...Object.keys(document.definitions));
  }
  if (
    document.components?.schemas &&
    typeof document.components.schemas === "object"
  ) {
    names.push(...Object.keys(document.components.schemas));
  }
  return names.map((name) => name.toLowerCase());
}

function assertSafeOpenApi(text, probeName) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw failure("INVALID_OPENAPI", probeName, 200);
  }

  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    !document.paths ||
    typeof document.paths !== "object" ||
    Array.isArray(document.paths)
  ) {
    throw failure("INVALID_OPENAPI", probeName, 200);
  }

  const names = schemaNames(document);
  const exposesPrivateObject = names.some((name) =>
    PRIVATE_OBJECT_NAMES.has(name),
  );
  if (
    Object.keys(document.paths).length > 0 ||
    exposesPrivateObject ||
    text.toLowerCase().includes(PRIVATE_SCHEMA)
  ) {
    throw failure("OPENAPI_EXPOSED_RESOURCE", probeName, 200);
  }
}

function requestHeaders(probe, key) {
  const headers = new Headers({
    accept: probe.accept ?? "application/json",
    apikey: key,
  });
  if (probe.profile) headers.set("accept-profile", probe.profile);
  return headers;
}

async function executeProbe(apiUrl, key, probe, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body;
  try {
    response = await fetchImpl(new URL(probe.path, apiUrl), {
      cache: "no-store",
      credentials: "omit",
      headers: requestHeaders(probe, key),
      method: "GET",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    body = await readBoundedText(response, probe.name);
  } catch (error) {
    if (error instanceof TestTargetDataApiError) throw error;
    throw failure("REQUEST_FAILED", probe.name);
  } finally {
    clearTimeout(timer);
  }

  assertNoSensitiveResponse(body, key, probe.name, response.status);

  if (probe.kind === "openapi") {
    if (response.status === 200) assertSafeOpenApi(body, probe.name);
    else if (!OPENAPI_DENIAL_STATUSES.has(response.status)) {
      throw failure("UNEXPECTED_STATUS", probe.name, response.status);
    }
  } else if (!probe.allowedStatuses.has(response.status)) {
    throw failure("UNEXPECTED_STATUS", probe.name, response.status);
  }

  return Object.freeze({ name: probe.name, status: response.status });
}

export async function runTestTargetDataApiProbes(
  config,
  { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const key = validateInputs(config, fetchImpl, timeoutMs);
  const results = [];
  for (const probe of PROBES) {
    results.push(
      await executeProbe(config.apiUrl, key, probe, fetchImpl, timeoutMs),
    );
  }
  return Object.freeze({
    ok: true,
    projectRef: config.projectRef,
    probes: Object.freeze(results),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const config = parseTestTargetConfig(process.env);
    const result = await runTestTargetDataApiProbes(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message =
      error instanceof TestTargetConfigError ||
      error instanceof TestTargetDataApiError
        ? error.message
        : "TEST Data API boundary verification failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
