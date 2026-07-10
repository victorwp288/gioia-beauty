import { CookieJar, responseSetCookies } from "./http-cookie-jar.mjs";

export { CookieJar } from "./http-cookie-jar.mjs";

const OWNER_SESSION_COOKIE = "gioia_owner_session";
const OWNER_CSRF_COOKIE = "gioia_owner_csrf";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function assertNoSecurityCookies(response, supabasePrefix) {
  const forbidden = responseSetCookies(response).some((serialized) => {
    const separator = serialized.indexOf("=");
    if (separator < 1) {
      throw new Error("Rejected owner route returned a malformed cookie");
    }
    const name = serialized.slice(0, separator).trim();
    return (
      name === OWNER_SESSION_COOKIE ||
      name === OWNER_CSRF_COOKIE ||
      name.startsWith(supabasePrefix)
    );
  });
  if (forbidden) {
    throw new Error("Rejected owner route issued security cookies");
  }
}

function privateResponse(response, operation) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (!cacheControl.includes("private") || !cacheControl.includes("no-store")) {
    throw new Error(`${operation} did not return private no-store headers`);
  }
}

function requireCookieAttributes(jar, prefix, expectation) {
  const sets = jar.attributeSets(prefix);
  if (
    sets.length === 0 ||
    sets.some(
      (attributes) =>
        expectation.required.some((value) => !attributes.includes(value)) ||
        expectation.forbidden.some((value) => attributes.includes(value)),
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

async function expectStatus(
  response,
  status,
  code,
  operation,
  expectedKeys = ["code"],
) {
  privateResponse(response, operation);
  const body = await responseBody(response, operation);
  const actualKeys = Object.keys(body).sort();
  const exactBody =
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === [...expectedKeys].sort()[index]);
  if (response.status !== status || body.code !== code || !exactBody) {
    const safeCode =
      typeof body.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(body.code)
        ? body.code
        : "UNSAFE_OR_MISSING_CODE";
    throw new Error(
      `${operation} returned status ${response.status} (${safeCode})`,
    );
  }
  return body;
}

function routeRequest(fetchImpl, baseUrl, path, options = {}) {
  const headers = new Headers(options.headers);
  const cookie = options.jar?.header() ?? options.cookie;
  if (cookie) headers.set("cookie", cookie);
  return fetchImpl(new URL(path, baseUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

function validateScenario({
  baseUrl,
  owner,
  cookieSecurity,
  reconcileLedger,
  fetchImpl,
}) {
  const url = baseUrl instanceof URL ? baseUrl : new URL(String(baseUrl));
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    !["", "/"].includes(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error("Owner route scenario requires a safe HTTP base URL");
  }
  if (
    !owner ||
    typeof owner.email !== "string" ||
    typeof owner.password !== "string"
  ) {
    throw new Error("Owner route scenario requires an owner fixture");
  }
  if (
    typeof reconcileLedger !== "function" ||
    typeof fetchImpl !== "function"
  ) {
    throw new Error("Owner route scenario requires injected operations");
  }
  for (const key of ["session", "csrf", "supabase"]) {
    const expectation = cookieSecurity?.[key];
    if (
      !expectation ||
      !Array.isArray(expectation.required) ||
      !Array.isArray(expectation.forbidden) ||
      (key === "supabase" &&
        (typeof expectation.namePrefix !== "string" ||
          !expectation.namePrefix.startsWith("sb-")))
    ) {
      throw new Error("Owner route scenario requires cookie expectations");
    }
  }
  return url;
}

export async function runOwnerAuthRouteScenario(options) {
  const {
    owner,
    cookieSecurity,
    reconcileLedger,
    fetchImpl = globalThis.fetch,
  } = options;
  const baseUrl = validateScenario({ ...options, fetchImpl });
  const jar = new CookieJar();

  const unauthenticated = await routeRequest(
    fetchImpl,
    baseUrl,
    "/api/auth/session",
  );
  assertNoSecurityCookies(unauthenticated, cookieSecurity.supabase.namePrefix);
  await expectStatus(
    unauthenticated,
    401,
    "OWNER_SESSION_REQUIRED",
    "unauthenticated session",
  );

  const loginBody = JSON.stringify({
    email: owner.email,
    password: owner.password,
  });
  const foreignOrigin = await routeRequest(
    fetchImpl,
    baseUrl,
    "/api/auth/login",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.invalid",
      },
      body: loginBody,
    },
  );
  assertNoSecurityCookies(foreignOrigin, cookieSecurity.supabase.namePrefix);
  await expectStatus(
    foreignOrigin,
    403,
    "FORBIDDEN_ORIGIN",
    "foreign-origin login",
  );

  const login = await routeRequest(fetchImpl, baseUrl, "/api/auth/login", {
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
    ["code", "csrfToken"],
  );
  jar.apply(login);
  if (
    typeof loginResult.csrfToken !== "string" ||
    !jar.has(OWNER_SESSION_COOKIE) ||
    !jar.has(OWNER_CSRF_COOKIE) ||
    !jar.has(cookieSecurity.supabase.namePrefix)
  ) {
    throw new Error("Owner login did not issue the complete cookie set");
  }
  requireCookieAttributes(jar, OWNER_SESSION_COOKIE, cookieSecurity.session);
  requireCookieAttributes(jar, OWNER_CSRF_COOKIE, cookieSecurity.csrf);
  requireCookieAttributes(
    jar,
    cookieSecurity.supabase.namePrefix,
    cookieSecurity.supabase,
  );

  const active = await routeRequest(fetchImpl, baseUrl, "/api/auth/session", {
    jar,
  });
  const activeResult = await expectStatus(
    active,
    200,
    "OWNER_SESSION_ACTIVE",
    "active owner session",
    ["code", "csrfToken"],
  );
  jar.apply(active);
  if (activeResult.csrfToken !== loginResult.csrfToken) {
    throw new Error("Owner session returned a mismatched CSRF token");
  }

  const replayCookie = jar.header();
  const logout = await routeRequest(fetchImpl, baseUrl, "/api/auth/logout", {
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
    jar.has(cookieSecurity.supabase.namePrefix)
  ) {
    throw new Error("Owner logout did not clear the complete cookie set");
  }

  const replay = await routeRequest(fetchImpl, baseUrl, "/api/auth/session", {
    cookie: replayCookie,
  });
  assertNoSecurityCookies(replay, cookieSecurity.supabase.namePrefix);
  await expectStatus(
    replay,
    401,
    "OWNER_SESSION_REQUIRED",
    "revoked cookie replay",
  );
  await reconcileLedger();
}
