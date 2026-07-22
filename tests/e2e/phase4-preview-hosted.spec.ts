import type { APIResponse } from "@playwright/test";

import {
  PREVIEW_BOOKING_IDEMPOTENCY_KEY,
  PREVIEW_BOOKING_PERSON,
} from "../../scripts/preview-e2e-fixtures.mjs";
import {
  assertBoundedOwnerReads,
  assertNoDirectBusinessTraffic,
  browserOwnerCommand,
  startBrowserTrafficAudit,
} from "./phase4-owner-fixture.ts";
import { expect, test } from "./phase4-preview-fixture.ts";

const TEST_SUPABASE_ORIGIN = "https://hzibzwhrwmljgjjdzspi.supabase.co";
const HOSTED_UI_TIMEOUT_MS = 20_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function privateNoStore(response: APIResponse) {
  const cacheControl = response.headers()["cache-control"] ?? "";
  expect(cacheControl).toContain("private");
  expect(cacheControl).toContain("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
}

test.describe.serial("Phase 4 hosted Preview acceptance", () => {
  test.describe.configure({ timeout: 120_000 });

  test("uses real TEST availability and creates one bounded synthetic booking", async ({
    baseURL,
    previewHarness,
    request,
  }) => {
    expect(baseURL).toBeDefined();
    const target = previewHarness.target;
    const query = new URLSearchParams({
      date: target.localDate,
      serviceId: target.serviceId,
      variantId: target.variantId,
    });
    const beforeAvailability = await previewHarness.snapshotAbuse();
    const availability = await request.get(`/api/availability?${query}`);
    await previewHarness.captureAbuseDelta(beforeAvailability, [
      "availability:network",
    ]);
    expect(availability.status(), await availability.text()).toBe(200);
    privateNoStore(availability);
    const available = (await availability.json()) as {
      date: string;
      serviceId: string;
      variantId: string;
      slots: number[];
    };
    expect(available).toMatchObject({
      date: target.localDate,
      serviceId: target.serviceId,
      variantId: target.variantId,
    });
    expect(available.slots.length).toBeLessThanOrEqual(96);
    expect(available.slots).toContain(600);
    expect(JSON.stringify(available)).not.toContain("example.test");

    const beforeBooking = await previewHarness.snapshotAbuse();
    const booking = await request.post("/api/bookings", {
      data: {
        date: target.localDate,
        startMinutes: 600,
        serviceId: target.serviceId,
        variantId: target.variantId,
        clientName: PREVIEW_BOOKING_PERSON.name,
        clientEmail: PREVIEW_BOOKING_PERSON.email,
        clientPhone: PREVIEW_BOOKING_PERSON.phone,
        clientNote: PREVIEW_BOOKING_PERSON.note,
      },
      headers: {
        "idempotency-key": PREVIEW_BOOKING_IDEMPOTENCY_KEY,
        origin: new URL(baseURL!).origin,
      },
    });
    await previewHarness.captureAbuseDelta(beforeBooking, [
      "booking:account",
      "booking:network",
    ]);
    expect(booking.status(), await booking.text()).toBe(201);
    privateNoStore(booking);
    expect(await booking.json()).toEqual({
      code: "BOOKING_CREATED",
      replayed: false,
      resourceId: expect.stringMatching(UUID),
    });
  });

  test("keeps owner traffic server-side and rehearses hosted maintenance", async ({
    page,
    previewHarness,
  }) => {
    const abuseBeforeLogin = await previewHarness.snapshotAbuse();
    const audit = startBrowserTrafficAudit(page);
    await page.goto("/login");
    await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({
      timeout: 20_000,
    });
    await page.getByLabel("Indirizzo email").fill(previewHarness.owner.email);
    await page.getByLabel("Password").fill(previewHarness.owner.password);
    await page.getByRole("button", { name: /^Accedi/u }).click();
    await expect(page).toHaveURL(/\/dashboard$/u, {
      timeout: HOSTED_UI_TIMEOUT_MS,
    });
    await previewHarness.captureAbuseDelta(abuseBeforeLogin, [
      "owner_login:account",
      "owner_login:network",
    ]);
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible({ timeout: HOSTED_UI_TIMEOUT_MS });
    await expect
      .poll(
        () =>
          [
            "/api/admin/schedule",
            "/api/admin/schedule/count",
            "/api/admin/vacations",
          ].every((path) =>
            audit.requests.some((url) => url.pathname === path),
          ),
        { timeout: HOSTED_UI_TIMEOUT_MS },
      )
      .toBe(true);
    assertBoundedOwnerReads(audit);
    assertNoDirectBusinessTraffic(audit, TEST_SUPABASE_ORIGIN);

    const freeze = await previewHarness.beginMaintenance();
    const frozenStatus = await page.request.get("/api/maintenance");
    expect(await frozenStatus.json()).toEqual({
      code: "MAINTENANCE_STATUS",
      messageCode: "MAINTENANCE_ACTIVE",
      ownerMutationsEnabled: false,
      publicBookingEnabled: false,
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("alert").filter({
        hasText: "Manutenzione attiva: le modifiche sono bloccate",
      }),
    ).toBeVisible({ timeout: HOSTED_UI_TIMEOUT_MS });
    const frozenOwner = await browserOwnerCommand(
      page,
      "/api/admin/appointments",
      {
        date: previewHarness.target.localDate,
        startMinutes: 540,
        serviceId: previewHarness.target.serviceId,
        variantId: previewHarness.target.variantId,
        clientName: "Preview frozen probe",
        clientEmail: null,
        clientPhone: null,
        clientNote: null,
      },
    );
    expect(frozenOwner).toMatchObject({
      body: { code: "MAINTENANCE_ACTIVE" },
      status: 503,
    });

    await previewHarness.completeMaintenance(freeze);
    const openStatus = await page.request.get("/api/maintenance");
    expect(await openStatus.json()).toEqual({
      code: "MAINTENANCE_STATUS",
      messageCode: "OPERATIONS_OPEN",
      ownerMutationsEnabled: true,
      publicBookingEnabled: true,
    });

    const logout = await page.evaluate(async () => {
      const session = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const sessionBody = (await session.json()) as { csrfToken?: unknown };
      const response = await fetch("/api/auth/logout", {
        credentials: "same-origin",
        headers: {
          "X-CSRF-Token": String(sessionBody.csrfToken ?? ""),
        },
        method: "POST",
      });
      return { body: await response.json(), status: response.status };
    });
    expect(logout).toEqual({
      body: { code: "OWNER_SESSION_ENDED" },
      status: 200,
    });
    await audit.waitForResponses();
    assertNoDirectBusinessTraffic(audit, TEST_SUPABASE_ORIGIN);
  });
});
