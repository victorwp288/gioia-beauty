import { expect, type Page, type Request, type Route } from "@playwright/test";

export const PHASE4_PUBLIC_CLOCK = new Date("2026-07-20T10:00:00+02:00");
export const PHASE4_PUBLIC_RESOURCE_ID = "44444444-4444-4444-8444-444444444444";
export const PHASE4_PUBLIC_REQUEST_ID = "44444444-4444-4444-9444-444444444444";
export const PHASE4_PUBLIC_PERSON = {
  name: "Cliente Sintetica Phase Quattro",
  email: "phase4-public-browser@example.invalid",
  phoneDigits: "393331234567",
  phoneNational: "3331234567",
  note: "Nota sintetica browser phase quattro",
} as const;

const PUBLIC_BUSINESS_API_PATHS = new Set([
  "/api/availability",
  "/api/bookings",
  "/api/maintenance",
  "/api/newsletter/subscribe",
]);
const RAW_DATA_PATH =
  /\/(?:rest|graphql|realtime|auth)\/v1(?:\/|$)|google\.firestore\.v1\.Firestore\//u;
const REMOTE_DATA_HOST =
  /(?:^|\.)(?:firebaseio\.com|firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|supabase\.co)$/u;

type RecordedRequest = {
  headers: Record<string, string>;
  method: string;
  postData: string | null;
  url: string;
};

export type PublicBrowserBoundaryAudit = ReturnType<
  typeof installPublicBrowserBoundaryAudit
>;

function containsSyntheticPii(value: string): boolean {
  const normalized = value.toLowerCase();
  return [
    PHASE4_PUBLIC_PERSON.name,
    PHASE4_PUBLIC_PERSON.email,
    PHASE4_PUBLIC_PERSON.phoneDigits,
    PHASE4_PUBLIC_PERSON.phoneNational,
    PHASE4_PUBLIC_PERSON.note,
  ].some(
    (candidate) =>
      normalized.includes(candidate.replaceAll(" ", "").toLowerCase()) ||
      normalized.includes(candidate.toLowerCase()),
  );
}

function compact(value: string): string {
  return value.replaceAll(/[\s+().-]/gu, "");
}

function requestRecord(request: Request): RecordedRequest {
  return {
    headers: request.headers(),
    method: request.method(),
    postData: request.postData(),
    url: request.url(),
  };
}

export function installPublicBrowserBoundaryAudit(page: Page) {
  const requests: RecordedRequest[] = [];
  const consoleMessages: string[] = [];
  const apiResponseBodies: string[] = [];
  const responseReadFailures: string[] = [];
  const webSocketUrls: string[] = [];
  const pendingResponseChecks = new Set<Promise<void>>();

  page.on("request", (request) => requests.push(requestRecord(request)));
  page.on("websocket", (webSocket) => webSocketUrls.push(webSocket.url()));
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("response", (response) => {
    let responseUrl: URL;
    try {
      responseUrl = new URL(response.url());
    } catch {
      return;
    }
    if (!PUBLIC_BUSINESS_API_PATHS.has(responseUrl.pathname)) return;
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("application/json")) return;
    const check = response
      .text()
      .then((body) => {
        apiResponseBodies.push(body);
      })
      .catch((error: unknown) => {
        responseReadFailures.push(
          `${responseUrl.href}: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => pendingResponseChecks.delete(check));
    pendingResponseChecks.add(check);
  });

  return {
    requests,
    businessRequests() {
      return requests.filter((request) => {
        try {
          return PUBLIC_BUSINESS_API_PATHS.has(new URL(request.url).pathname);
        } catch {
          return false;
        }
      });
    },
    async assertSafe(options: { bookingPosts?: number } = {}) {
      while (pendingResponseChecks.size > 0) {
        await Promise.all([...pendingResponseChecks]);
      }
      expect(
        responseReadFailures,
        "public API response bodies must be readable for the privacy audit",
      ).toEqual([]);
      const directDataRequests = [
        ...requests.map(({ method, url }) => ({ method, url })),
        ...webSocketUrls.map((url) => ({ method: "WEBSOCKET", url })),
      ].filter((request) => {
        try {
          const target = new URL(request.url);
          return (
            REMOTE_DATA_HOST.test(target.hostname) ||
            RAW_DATA_PATH.test(target.pathname)
          );
        } catch {
          return true;
        }
      });
      expect(
        directDataRequests.map(({ method, url }) => `${method} ${url}`),
        "the public browser must not address Firebase or Supabase data/Auth protocols directly",
      ).toEqual([]);

      const bookingPosts = requests.filter((request) => {
        try {
          return (
            request.method === "POST" &&
            new URL(request.url).pathname === "/api/bookings"
          );
        } catch {
          return false;
        }
      });
      expect(bookingPosts).toHaveLength(options.bookingPosts ?? 0);

      const leakedRequests = requests.filter((request) => {
        let isBookingBody = false;
        try {
          isBookingBody =
            request.method === "POST" &&
            new URL(request.url).pathname === "/api/bookings";
        } catch {
          return true;
        }
        const inspect = JSON.stringify({
          headers: request.headers,
          url: request.url,
          postData: isBookingBody ? null : request.postData,
        });
        return (
          containsSyntheticPii(inspect) ||
          containsSyntheticPii(compact(inspect))
        );
      });
      expect(
        leakedRequests.map(({ method, url }) => `${method} ${url}`),
        "appointment PII is allowed only in the same-origin booking JSON body",
      ).toEqual([]);
      expect(
        consoleMessages.filter(
          (message) =>
            containsSyntheticPii(message) ||
            containsSyntheticPii(compact(message)),
        ),
        "appointment PII must not reach browser console output",
      ).toEqual([]);
      expect(
        apiResponseBodies.filter(
          (body) =>
            containsSyntheticPii(body) || containsSyntheticPii(compact(body)),
        ),
        "public API responses must not echo appointment PII",
      ).toEqual([]);
    },
  };
}

export async function installAvailabilityRoute(
  page: Page,
  resolver: (call: number, request: Request) => number[] | "unavailable",
) {
  let calls = 0;
  await page.route("**/api/availability?**", async (route) => {
    calls += 1;
    const request = route.request();
    const result = resolver(calls, request);
    if (result === "unavailable") {
      await json(route, 503, {
        code: "SERVICE_UNAVAILABLE",
        requestId: PHASE4_PUBLIC_REQUEST_ID,
      });
      return;
    }
    const target = new URL(request.url());
    await json(route, 200, {
      date: target.searchParams.get("date"),
      serviceId: target.searchParams.get("serviceId"),
      variantId: target.searchParams.get("variantId"),
      slots: result,
    });
  });
  return { calls: () => calls };
}

export async function json(
  route: Route,
  status: number,
  body: Record<string, unknown>,
) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json; charset=utf-8",
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

export async function openStablePublicHome(page: Page) {
  const hydrationFailures: string[] = [];
  page.on("pageerror", (error) => hydrationFailures.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.resourceType() === "script") {
      hydrationFailures.push(
        `${request.failure()?.errorText ?? "script failed"}: ${request.url()}`,
      );
    }
  });
  page.on("response", (response) => {
    if (
      response.request().resourceType() === "script" &&
      response.status() >= 400
    ) {
      hydrationFailures.push(`${response.status()}: ${response.url()}`);
    }
  });
  await page.clock.setFixedTime(PHASE4_PUBLIC_CLOCK);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1_440, height: 1_000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Prenota un appuntamento" }),
  ).toBeVisible();
  try {
    await expect
      .poll(
        () =>
          page
            .getByRole("combobox", { name: "Trattamento*" })
            .locator("option")
            .count(),
        {
          message: "the booking form must be hydrated with its service catalog",
          timeout: 30_000,
        },
      )
      .toBeGreaterThan(2);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nHydration failures: ${hydrationFailures.join(" | ") || "none reported"}`,
    );
  }
}

export async function selectFirstAvailableDateWithKeyboard(page: Page) {
  // The fixed clock makes 2026-07-22 a deterministic open Wednesday. Target
  // its grid cell so outside/past DayPicker buttons can never be selected.
  const day = page.getByRole("gridcell", { name: "22", exact: true });
  await expect(day).toBeVisible();
  await day.focus();
  await expect(day).toBeFocused();
  await page.keyboard.press("Enter");
}

export async function chooseSlotWithKeyboard(page: Page, label = "09:00") {
  const slot = page.getByRole("button", { name: label, exact: true });
  await expect(slot).toBeVisible();
  await slot.focus();
  await expect(slot).toBeFocused();
  await page.keyboard.press("Enter");
}

export async function fillSyntheticBooking(page: Page) {
  await page.getByLabel("Nome e Cognome*").fill(PHASE4_PUBLIC_PERSON.name);
  await page.getByLabel("Email*").fill(PHASE4_PUBLIC_PERSON.email);
  await page
    .getByPlaceholder("Note aggiuntive (opzionale)")
    .fill(PHASE4_PUBLIC_PERSON.note);
  await page
    .locator(".react-tel-input input")
    .fill(PHASE4_PUBLIC_PERSON.phoneNational);
}

export async function removeLocalFrameworkDevOverlay(page: Page) {
  await page.locator("nextjs-portal").evaluateAll((portals) => {
    portals.forEach((portal) => portal.remove());
  });
}

export async function assertBookingBody(request: Request) {
  const body = request.postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({
    clientEmail: PHASE4_PUBLIC_PERSON.email,
    clientName: PHASE4_PUBLIC_PERSON.name,
    clientNote: PHASE4_PUBLIC_PERSON.note,
  });
  expect([
    compact(PHASE4_PUBLIC_PERSON.phoneDigits),
    compact(PHASE4_PUBLIC_PERSON.phoneNational),
  ]).toContain(compact(String(body.clientPhone)));
  expect(request.url()).not.toContain(PHASE4_PUBLIC_PERSON.email);
  expect(await request.headerValue("idempotency-key")).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
}
