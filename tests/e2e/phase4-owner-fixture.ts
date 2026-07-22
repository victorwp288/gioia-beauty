import { createHash, randomUUID } from "node:crypto";

import { expect, test as base, type Page, type Route } from "@playwright/test";
import postgres from "postgres";

import { SERVICE_CATALOG } from "../../lib/domain/catalog/index.ts";
import { getBookingConcurrencyTargets } from "../../scripts/booking-concurrency-suite.mjs";
import {
  LOCAL_PHASE4_OWNER_LOGIN_NETWORK,
  LOCAL_SYNTHETIC_OWNER,
} from "../../scripts/local-phase3-e2e-contract.mjs";
import { clearLocalPhase4OwnerLoginAbuse } from "../../scripts/local-phase4-owner-abuse-isolation.mjs";
import { createLocalCutoverOperator } from "../../scripts/local-cutover-maintenance-operator.mjs";
import { getLocalRouteStatus } from "../../scripts/local-owner-auth-harness.mjs";

export { LOCAL_SYNTHETIC_OWNER };

export type LocalDatabase = ReturnType<typeof postgres>;
export type LocalCutoverOperator = ReturnType<
  typeof createLocalCutoverOperator
>;

export interface OwnerBookingTarget {
  readonly date: string;
  readonly durationMinutes: number;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly variantId: string;
}

interface Phase4OwnerFixtures {
  readonly localDatabase: LocalDatabase;
  readonly cutoverOperator: LocalCutoverOperator;
  readonly ownerBookingTarget: OwnerBookingTarget;
  readonly localSupabaseOrigin: string;
}

export interface BrowserTrafficAudit {
  readonly requests: URL[];
  readonly responseBodies: string[];
  readonly responseReadFailures: string[];
  readonly webSockets: URL[];
  waitForResponses(): Promise<void>;
}

interface BrowserCommandResult {
  readonly body: Record<string, unknown>;
  readonly retryAfter: string | null;
  readonly status: number;
}

function exactOwnerBookingTarget(value: unknown): OwnerBookingTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local owner booking target is invalid");
  }
  const candidate = value as Record<string, unknown>;
  const service = SERVICE_CATALOG.services.find(
    (item) => item.id === candidate.serviceId && item.active,
  );
  const variant = service?.variants.find(
    (item) => item.id === candidate.variantId && item.active,
  );
  if (
    typeof candidate.localDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(candidate.localDate) ||
    !service ||
    !variant
  ) {
    throw new Error("Local owner booking target is unavailable");
  }
  return Object.freeze({
    date: candidate.localDate,
    durationMinutes: variant.serviceDurationMinutes,
    serviceId: service.id,
    serviceName: service.nameIt,
    variantId: variant.id,
  });
}

export const test = base.extend<Phase4OwnerFixtures>({
  localDatabase: async ({}, provide) => {
    const status = await getLocalRouteStatus();
    const database = postgres(status.databaseUrl, {
      prepare: false,
      max: 1,
      idle_timeout: 1,
      connect_timeout: 5,
      onnotice: () => {},
    });
    try {
      await clearLocalPhase4OwnerLoginAbuse(database);
      await provide(database);
    } finally {
      try {
        await clearLocalPhase4OwnerLoginAbuse(database);
      } finally {
        await database.end({ timeout: 2 });
      }
    }
  },
  cutoverOperator: async ({ localDatabase }, provide) => {
    const status = await getLocalRouteStatus();
    const adminUrl = new URL(status.databaseUrl);
    adminUrl.username = "supabase_admin";
    const admin = postgres(adminUrl.href, { prepare: false, max: 1 });
    try {
      await admin.unsafe(
        "grant gioia_mutator to postgres with inherit false, set true granted by current_user",
      );
      const operatorDatabase = {
        unsafe: (query: string, parameters?: unknown[]) =>
          localDatabase.begin(async (transaction) => {
            await transaction.unsafe("set local role gioia_mutator");
            return transaction.unsafe(
              query,
              parameters as Parameters<typeof transaction.unsafe>[1],
            );
          }),
      };
      await provide(
        createLocalCutoverOperator({
          database: operatorDatabase,
          env: {
            ...process.env,
            APP_ENV: "test",
            SUPABASE_DATABASE_URL: status.databaseUrl,
          },
        }),
      );
    } finally {
      await admin.unsafe(
        "revoke gioia_mutator from postgres granted by current_user",
      );
      await admin.end({ timeout: 2 });
    }
  },
  ownerBookingTarget: async ({ localDatabase }, provide) => {
    const targets = (await getBookingConcurrencyTargets(
      localDatabase,
    )) as unknown;
    if (!Array.isArray(targets) || targets.length < 1) {
      throw new Error("Local booking targets are unavailable");
    }
    await provide(exactOwnerBookingTarget(targets[0]));
  },
  localSupabaseOrigin: async ({}, provide) => {
    const status = await getLocalRouteStatus();
    await provide(status.apiUrl.origin);
  },
});

export async function withSyntheticOwnerLoginNetwork<T>(
  page: Page,
  operation: () => Promise<T>,
): Promise<T> {
  const pattern = "**/api/auth/login";
  const handler = async (route: Route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-forwarded-for": LOCAL_PHASE4_OWNER_LOGIN_NETWORK,
      },
    });
  };
  await page.route(pattern, handler);
  try {
    return await operation();
  } finally {
    await page.unroute(pattern, handler);
  }
}

export async function loginOwnerThroughUi(page: Page): Promise<void> {
  await withSyntheticOwnerLoginNetwork(page, async () => {
    await page.goto("/login");
    await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({
      timeout: 20_000,
    });
    await page.getByLabel("Indirizzo email").fill(LOCAL_SYNTHETIC_OWNER.email);
    await page.getByLabel("Password").fill(LOCAL_SYNTHETIC_OWNER.password);
    await page.getByRole("button", { name: /^Accedi/u }).click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
  });
}

export async function availableStartMinutes(
  page: Page,
  target: OwnerBookingTarget,
): Promise<number> {
  const query = new URLSearchParams({
    date: target.date,
    serviceId: target.serviceId,
    variantId: target.variantId,
  });
  const response = await page.request.get(`/api/availability?${query}`);
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    slots?: unknown[];
  };
  const startMinutes = payload.slots?.[0];
  if (!Number.isInteger(startMinutes)) {
    throw new Error("Local owner booking slot is unavailable");
  }
  return startMinutes as number;
}

export function timeFromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;
}

export async function createNoEmailAppointmentThroughUi(
  page: Page,
  target: OwnerBookingTarget,
  startMinutes: number,
  clientName: string,
): Promise<void> {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: /Nuovo appuntamento/u }).click();
  await expect(
    page.getByRole("heading", { name: "Aggiungi nuovo appuntamento" }),
  ).toBeVisible();
  await page.locator("#name").fill(clientName);
  await page.locator("select#appointmentType").selectOption(target.serviceName);
  await page.locator("#duration").fill(String(target.durationMinutes));
  await page.locator("#startTime").fill(timeFromMinutes(startMinutes));
  await page.locator("#selectedDate").fill(target.date);
  await expect(page.locator("#email")).toHaveValue("");
  await page.getByRole("button", { name: "Crea appuntamento" }).click();
}

export async function browserOwnerCommand(
  page: Page,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey = randomUUID(),
  canaryToken?: string,
  knownCsrfToken?: string,
): Promise<BrowserCommandResult> {
  return page.evaluate(
    async ({ body, canaryToken, idempotencyKey, knownCsrfToken, path }) => {
      let csrfToken = knownCsrfToken;
      if (!csrfToken) {
        const sessionResponse = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const session = (await sessionResponse.json()) as {
          csrfToken?: unknown;
        } & Record<string, unknown>;
        if (!sessionResponse.ok || typeof session.csrfToken !== "string") {
          return {
            body: session,
            retryAfter: sessionResponse.headers.get("retry-after"),
            status: sessionResponse.status,
          };
        }
        csrfToken = session.csrfToken;
      }
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-CSRF-Token": csrfToken,
      };
      if (canaryToken) headers["X-Gioia-Cutover-Canary"] = canaryToken;
      const response = await fetch(path, {
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        headers,
        method: "POST",
      });
      return {
        body: (await response.json()) as Record<string, unknown>,
        retryAfter: response.headers.get("retry-after"),
        status: response.status,
      };
    },
    { body, canaryToken, idempotencyKey, knownCsrfToken, path },
  );
}

export async function browserPublicBooking(
  page: Page,
  body: Record<string, unknown>,
  idempotencyKey = randomUUID(),
  canaryToken?: string,
): Promise<BrowserCommandResult> {
  return page.evaluate(
    async ({ body, canaryToken, idempotencyKey }) => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      };
      if (canaryToken) headers["X-Gioia-Cutover-Canary"] = canaryToken;
      const response = await fetch("/api/bookings", {
        body: JSON.stringify(body),
        credentials: "same-origin",
        headers,
        method: "POST",
      });
      return {
        body: (await response.json()) as Record<string, unknown>,
        retryAfter: response.headers.get("retry-after"),
        status: response.status,
      };
    },
    { body, canaryToken, idempotencyKey },
  );
}

export function ownerCommandFingerprint(
  operation: string,
  request: Record<string, unknown>,
): Buffer {
  const canonical = JSON.stringify(
    { operation, request, version: 1 },
    (_key, value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(
          ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
        ),
      );
    },
  );
  return createHash("sha256").update(canonical, "utf8").digest();
}

export function startBrowserTrafficAudit(page: Page): BrowserTrafficAudit {
  const requests: URL[] = [];
  const responseBodies: string[] = [];
  const responseReadFailures: string[] = [];
  const webSockets: URL[] = [];
  const pendingResponseReads = new Set<Promise<void>>();
  page.on("request", (request) => {
    requests.push(new URL(request.url()));
  });
  page.on("websocket", (webSocket) => {
    webSockets.push(new URL(webSocket.url()));
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("application/json")) return;
    const read = response
      .text()
      .then((body) => responseBodies.push(body))
      .catch((error: unknown) => {
        responseReadFailures.push(
          `${url.href}: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .then(() => undefined)
      .finally(() => pendingResponseReads.delete(read));
    pendingResponseReads.add(read);
  });
  return {
    requests,
    responseBodies,
    responseReadFailures,
    webSockets,
    async waitForResponses() {
      while (pendingResponseReads.size > 0) {
        await Promise.all([...pendingResponseReads]);
      }
      expect(
        responseReadFailures,
        "owner API response bodies must be readable for the privacy audit",
      ).toEqual([]);
    },
  };
}

export function assertNoDirectBusinessTraffic(
  audit: BrowserTrafficAudit,
  localSupabaseOrigin: string,
): void {
  const forbiddenProviderHost =
    /(^|\.)(firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|googleapis\.com|supabase\.co)$/u;
  const rawProviderPath =
    /\/(?:rest|graphql|realtime|auth)\/v1(?:\/|$)|google\.firestore\.v1\.Firestore\//u;
  const isDirect = (url: URL) => {
    if (url.origin === localSupabaseOrigin) return true;
    if (rawProviderPath.test(url.pathname)) return true;
    if (!forbiddenProviderHost.test(url.hostname)) return false;
    return (
      url.hostname.includes("firebase") ||
      url.hostname.includes("supabase") ||
      [
        "firestore.googleapis.com",
        "identitytoolkit.googleapis.com",
        "securetoken.googleapis.com",
      ].includes(url.hostname)
    );
  };
  const direct = [...audit.requests, ...audit.webSockets].filter(isDirect);
  expect(direct.map((url) => url.href)).toEqual([]);
}

export function assertBoundedOwnerReads(audit: BrowserTrafficAudit): void {
  const reads = audit.requests.filter((url) =>
    url.pathname.startsWith("/api/admin/"),
  );
  const schedule = reads.find((url) => url.pathname === "/api/admin/schedule");
  const count = reads.find(
    (url) => url.pathname === "/api/admin/schedule/count",
  );
  const vacations = reads.find(
    (url) => url.pathname === "/api/admin/vacations",
  );
  expect(schedule, "bounded dashboard schedule read").toBeDefined();
  expect(count, "bounded dashboard count read").toBeDefined();
  expect(vacations, "bounded dashboard vacation read").toBeDefined();
  for (const url of [schedule, count, vacations]) {
    expect(url?.searchParams.get("fromDate")).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(url?.searchParams.get("toDate")).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  }
  expect(Number(schedule?.searchParams.get("pageSize"))).toBeLessThanOrEqual(
    100,
  );
  expect(Number(vacations?.searchParams.get("pageSize"))).toBeLessThanOrEqual(
    100,
  );
}

export { expect };
