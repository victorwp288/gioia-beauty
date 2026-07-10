import { fileURLToPath } from "node:url";

import postgres from "postgres";

import {
  CookieJar,
  getLocalRouteStatus,
  withLocalOwnerAuthServer,
} from "./local-owner-auth-harness.mjs";
import { LOCAL_SYNTHETIC_OWNER } from "./test-local-auth-seed.mjs";

const OWNER_SESSION_COOKIE = "gioia_owner_session";
const OWNER_CSRF_COOKIE = "gioia_owner_csrf";

function privateResponse(response, operation) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (!cacheControl.includes("private") || !cacheControl.includes("no-store")) {
    throw new Error(`${operation} did not return private no-store headers`);
  }
}

function requireCookieAttributes(jar, prefix, required, forbidden = []) {
  const sets = jar.attributeSets(prefix);
  if (
    sets.length === 0 ||
    sets.some(
      (attributes) =>
        required.some((value) => !attributes.includes(value)) ||
        forbidden.some((value) => attributes.includes(value)),
    )
  ) {
    throw new Error("Owner route returned unsafe cookie attributes");
  }
}

async function responseBody(response, operation) {
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${operation} returned a non-object response`);
  }
  return body;
}

async function expectStatus(response, status, code, operation) {
  privateResponse(response, operation);
  const body = await responseBody(response, operation);
  if (response.status !== status || body.code !== code) {
    throw new Error(`${operation} returned an unexpected safe result`);
  }
  return body;
}

function routeRequest(baseUrl, path, options = {}) {
  const headers = new Headers(options.headers);
  const cookie = options.jar?.header() ?? options.cookie;
  if (cookie) headers.set("cookie", cookie);
  return fetch(new URL(path, baseUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

async function reconcileLedger(databaseUrl) {
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  try {
    const [row] = await sql.unsafe(
      "select count(*)::integer as total, " +
        "count(*) filter (where revoked_at is not null)::integer as revoked, " +
        "count(*) filter (where revoked_at is null and expires_at > clock_timestamp())::integer as active " +
        "from gioia_private.owner_sessions where user_id = $1::uuid",
      [LOCAL_SYNTHETIC_OWNER.id],
    );
    if (row?.total !== 1 || row.revoked !== 1 || row.active !== 0) {
      throw new Error("Owner session ledger did not reconcile after logout");
    }
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function verifyOwnerAuthRoutes(baseUrl, status) {
  const jar = new CookieJar();

  const unauthenticated = await routeRequest(baseUrl, "/api/auth/session");
  await expectStatus(
    unauthenticated,
    401,
    "OWNER_SESSION_REQUIRED",
    "unauthenticated session",
  );

  const loginBody = JSON.stringify({
    email: LOCAL_SYNTHETIC_OWNER.email,
    password: LOCAL_SYNTHETIC_OWNER.password,
  });
  const foreignOrigin = await routeRequest(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.invalid",
    },
    body: loginBody,
  });
  await expectStatus(
    foreignOrigin,
    403,
    "FORBIDDEN_ORIGIN",
    "foreign-origin login",
  );

  const login = await routeRequest(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl.origin,
    },
    body: loginBody,
  });
  const loginResult = await expectStatus(
    login,
    200,
    "OWNER_SESSION_CREATED",
    "owner login",
  );
  jar.apply(login);
  if (
    typeof loginResult.csrfToken !== "string" ||
    !jar.has(OWNER_SESSION_COOKIE) ||
    !jar.has(OWNER_CSRF_COOKIE) ||
    !jar.has("sb-")
  ) {
    throw new Error("Owner login did not issue the complete cookie set");
  }
  requireCookieAttributes(
    jar,
    OWNER_SESSION_COOKIE,
    ["httponly", "path=/", "samesite=strict", "max-age=43200"],
    ["secure"],
  );
  requireCookieAttributes(
    jar,
    OWNER_CSRF_COOKIE,
    ["path=/", "samesite=strict", "max-age=43200"],
    ["httponly", "secure"],
  );
  requireCookieAttributes(
    jar,
    "sb-",
    ["httponly", "path=/", "samesite=lax"],
    ["secure"],
  );

  const active = await routeRequest(baseUrl, "/api/auth/session", { jar });
  const activeResult = await expectStatus(
    active,
    200,
    "OWNER_SESSION_ACTIVE",
    "active owner session",
  );
  jar.apply(active);
  if (activeResult.csrfToken !== loginResult.csrfToken) {
    throw new Error("Owner session returned a mismatched CSRF token");
  }

  const replayCookie = jar.header();
  const logout = await routeRequest(baseUrl, "/api/auth/logout", {
    method: "POST",
    jar,
    headers: {
      origin: baseUrl.origin,
      "x-csrf-token": loginResult.csrfToken,
    },
  });
  await expectStatus(logout, 200, "OWNER_SESSION_ENDED", "owner logout");
  jar.apply(logout);
  if (
    jar.has(OWNER_SESSION_COOKIE) ||
    jar.has(OWNER_CSRF_COOKIE) ||
    jar.has("sb-")
  ) {
    throw new Error("Owner logout did not clear the complete cookie set");
  }

  const replay = await routeRequest(baseUrl, "/api/auth/session", {
    cookie: replayCookie,
  });
  await expectStatus(
    replay,
    401,
    "OWNER_SESSION_REQUIRED",
    "revoked cookie replay",
  );
  await reconcileLedger(status.databaseUrl);
}

export async function runLocalOwnerAuthRouteTest() {
  const status = await getLocalRouteStatus();
  await withLocalOwnerAuthServer(status, (baseUrl) =>
    verifyOwnerAuthRoutes(baseUrl, status),
  );
  process.stdout.write(
    "Local owner route login, logout, and replay rejection passed.\n",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLocalOwnerAuthRouteTest().catch((error) => {
    process.stderr.write(
      `Local owner Auth route test failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
