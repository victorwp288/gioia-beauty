import type { APIResponse } from "@playwright/test";

import {
  PREVIEW_BOOKING_IDEMPOTENCY_KEY,
  PREVIEW_BOOKING_PERSON,
} from "../../scripts/preview-e2e-fixtures.mjs";
import { PREVIEW_MAINTENANCE } from "../../scripts/preview-e2e-maintenance-fixture.mjs";
import {
  assertBoundedOwnerReads,
  assertNoDirectBusinessTraffic,
  browserOwnerCommand,
  browserPublicBooking,
  ownerCommandFingerprint,
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
    page,
    previewHarness,
    request,
  }) => {
    expect(baseURL).toBeDefined();
    const target = previewHarness.target;
    const privacyTarget = previewHarness.maintenanceTarget;
    const query = new URLSearchParams({
      date: privacyTarget.localDate,
      serviceId: privacyTarget.serviceId,
      variantId: privacyTarget.variantId,
    });
    const audit = startBrowserTrafficAudit(page);
    await page.goto("/");
    const beforeAvailability = await previewHarness.snapshotAbuse();
    const availability = await page.evaluate(async (path) => {
      const response = await fetch(path, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      return {
        body: await response.json(),
        cacheControl: response.headers.get("cache-control"),
        status: response.status,
      };
    }, `/api/availability?${query}`);
    await previewHarness.captureAbuseDelta(beforeAvailability, [
      "availability:network",
    ]);
    expect(availability.status).toBe(200);
    expect(availability.cacheControl).toContain("private");
    expect(availability.cacheControl).toContain("no-store");
    const available = availability.body as {
      date: string;
      serviceId: string;
      variantId: string;
      slots: number[];
    };
    expect(available).toMatchObject({
      date: privacyTarget.localDate,
      serviceId: privacyTarget.serviceId,
      variantId: privacyTarget.variantId,
    });
    expect(available.slots.length).toBeLessThanOrEqual(96);
    expect(available.slots).toContain(600);
    await audit.waitForResponses();
    const privacyMarkers = [
      previewHarness.privacyProbe.email,
      previewHarness.privacyProbe.legacyId,
      previewHarness.privacyProbe.name,
    ];
    expect(
      audit.responseBodies.some((body) =>
        privacyMarkers.some((marker) => body.includes(marker)),
      ),
    ).toBe(false);
    assertNoDirectBusinessTraffic(audit, TEST_SUPABASE_ORIGIN);

    const anonymousOwnerRead = await request.get(
      `/api/admin/schedule?fromDate=${previewHarness.maintenanceTarget.localDate}` +
        `&toDate=${previewHarness.maintenanceTarget.localDate}&pageSize=1`,
    );
    expect(anonymousOwnerRead.status()).toBe(401);
    privateNoStore(anonymousOwnerRead);

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

    const staleTab = await page.context().newPage();
    const staleAudit = startBrowserTrafficAudit(staleTab);
    await staleTab.goto("/dashboard");
    await expect(
      staleTab.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible({ timeout: HOSTED_UI_TIMEOUT_MS });
    const staleCsrfToken = await staleTab.evaluate(async () => {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await response.json()) as { csrfToken?: unknown };
      if (!response.ok || typeof body.csrfToken !== "string") {
        throw new Error("Hosted stale tab has no CSRF token");
      }
      return body.csrfToken;
    });

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
    await expect(
      page.getByRole("button", { name: "Blocco rapido" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Nuovo appuntamento" }),
    ).toBeDisabled();
    const target = previewHarness.maintenanceTarget;
    const frozenOwner = await browserOwnerCommand(
      staleTab,
      "/api/admin/appointments",
      {
        date: target.localDate,
        startMinutes: 600,
        serviceId: target.serviceId,
        variantId: target.variantId,
        clientName: "Preview frozen probe",
        clientEmail: null,
        clientPhone: null,
        clientNote: null,
      },
      PREVIEW_MAINTENANCE.blockedOwnerKey,
      undefined,
      staleCsrfToken,
    );
    expect(frozenOwner).toMatchObject({
      body: { code: "MAINTENANCE_ACTIVE" },
      status: 503,
    });

    const blockedPublicBody = {
      date: target.localDate,
      startMinutes: 600,
      serviceId: target.serviceId,
      variantId: target.variantId,
      clientName: "Preview frozen public probe",
      clientEmail: "frozen.preview@example.test",
      clientPhone: "+390000000000",
      clientNote: null,
    };
    const beforeFrozenPublic = await previewHarness.snapshotAbuse();
    const frozenPublic = await browserPublicBooking(
      staleTab,
      blockedPublicBody,
      PREVIEW_MAINTENANCE.blockedPublicKey,
    );
    await previewHarness.captureAbuseDelta(beforeFrozenPublic, []);
    expect(frozenPublic).toMatchObject({
      body: { code: "MAINTENANCE_ACTIVE" },
      retryAfter: "300",
      status: 503,
    });

    const run = await previewHarness.beginCanaryRun(freeze);
    const canaryBody = {
      date: target.localDate,
      startMinutes: 600,
      serviceId: target.serviceId,
      variantId: target.variantId,
      clientName: PREVIEW_MAINTENANCE.canaryName,
      clientEmail: null,
      clientPhone: null,
      clientNote: null,
    };
    const createGrant = await previewHarness.issueCanaryGrant({
      runId: run.runId,
      operation: "owner_create_appointment",
      idempotencyKey: PREVIEW_MAINTENANCE.canaryCreateKey,
      requestFingerprint: ownerCommandFingerprint(
        "owner_create_appointment",
        canaryBody,
      ),
    });
    const canaryCreated = await browserOwnerCommand(
      page,
      "/api/admin/appointments",
      canaryBody,
      PREVIEW_MAINTENANCE.canaryCreateKey,
      createGrant.token,
    );
    expect(canaryCreated).toMatchObject({
      body: { code: "APPOINTMENT_CREATED" },
      status: 201,
    });
    expect(canaryCreated.body.resourceId).toEqual(expect.stringMatching(UUID));
    const canaryId = String(canaryCreated.body.resourceId);
    const canaryCancelBody = {
      entryId: canaryId,
      expectedVersion: 1,
      reason: "synthetic hosted canary cleanup",
    };
    const cancelGrant = await previewHarness.issueCanaryGrant({
      runId: run.runId,
      operation: "owner_cancel_schedule_entry",
      idempotencyKey: PREVIEW_MAINTENANCE.canaryCancelKey,
      requestFingerprint: ownerCommandFingerprint(
        "owner_cancel_schedule_entry",
        canaryCancelBody,
      ),
    });
    const canaryCancelled = await browserOwnerCommand(
      page,
      "/api/admin/schedule/cancel",
      canaryCancelBody,
      PREVIEW_MAINTENANCE.canaryCancelKey,
      cancelGrant.token,
    );
    expect(canaryCancelled).toMatchObject({
      body: { code: "SCHEDULE_ENTRY_CANCELLED" },
      status: 200,
    });
    await previewHarness.reconcileCanaryRun(freeze, run.runId);

    const reconcileVersion = await previewHarness.enterOwnerReconcile(freeze);
    const reconcileStatus = await page.request.get("/api/maintenance");
    expect(await reconcileStatus.json()).toMatchObject({
      messageCode: "OWNER_RECONCILIATION_ACTIVE",
      ownerMutationsEnabled: true,
      publicBookingEnabled: false,
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("button", { name: "Nuovo appuntamento" }),
    ).toBeEnabled();
    const beforeReconcilePublic = await previewHarness.snapshotAbuse();
    const reconcilePublic = await browserPublicBooking(
      page,
      blockedPublicBody,
      PREVIEW_MAINTENANCE.blockedPublicKey,
    );
    await previewHarness.captureAbuseDelta(beforeReconcilePublic, []);
    expect(reconcilePublic).toMatchObject({
      body: { code: "MAINTENANCE_ACTIVE" },
      status: 503,
    });

    const manualBody = {
      ...canaryBody,
      clientName: PREVIEW_MAINTENANCE.manualName,
    };
    const manualCreated = await browserOwnerCommand(
      page,
      "/api/admin/appointments",
      manualBody,
      PREVIEW_MAINTENANCE.manualCreateKey,
    );
    expect(manualCreated).toMatchObject({
      body: { code: "APPOINTMENT_CREATED" },
      status: 201,
    });
    expect(manualCreated.body.resourceId).toEqual(expect.stringMatching(UUID));
    const manualCancelled = await browserOwnerCommand(
      page,
      "/api/admin/schedule/cancel",
      {
        entryId: String(manualCreated.body.resourceId),
        expectedVersion: 1,
        reason: "synthetic hosted manual cleanup",
      },
      PREVIEW_MAINTENANCE.manualCancelKey,
    );
    expect(manualCancelled).toMatchObject({
      body: { code: "SCHEDULE_ENTRY_CANCELLED" },
      status: 200,
    });
    await previewHarness.verifyMaintenanceEvidence(freeze);

    expect(await previewHarness.unfreeze(freeze, reconcileVersion)).toBe(
      reconcileVersion + 1,
    );
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
    await staleAudit.waitForResponses();
    assertNoDirectBusinessTraffic(audit, TEST_SUPABASE_ORIGIN);
    assertNoDirectBusinessTraffic(staleAudit, TEST_SUPABASE_ORIGIN);
    await staleTab.close();
  });
});
