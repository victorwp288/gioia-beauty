import { randomUUID } from "node:crypto";

import {
  assertBoundedOwnerReads,
  assertNoDirectBusinessTraffic,
  availableStartMinutes,
  browserOwnerCommand,
  browserPublicBooking,
  createNoEmailAppointmentThroughUi,
  expect,
  loginOwnerThroughUi,
  LOCAL_SYNTHETIC_OWNER,
  ownerCommandFingerprint,
  startBrowserTrafficAudit,
  test,
} from "./phase4-owner-fixture.ts";

test.describe.serial("Phase 4 Local owner and maintenance acceptance", () => {
  test("keeps owner reads bounded and business data behind same-origin APIs", async ({
    browser,
    localDatabase,
    localSupabaseOrigin,
    ownerBookingTarget,
    page,
  }) => {
    const privacyLeakProbe = "other-customer-leak-probe@gioia.test";
    const privacyProbeRows = await localDatabase.unsafe(
      `insert into gioia_private.schedule_entries (
         kind, status, source, local_date, start_minutes,
         service_duration_minutes, buffer_minutes, service_id, variant_id,
         service_name_snapshot, variant_name_snapshot, price_cents_snapshot,
         currency_snapshot, client_name, client_email, legacy_firestore_id,
         imported_at, cancelled_at, cancelled_by, cancellation_reason
       )
       select 'appointment', 'cancelled', 'migration', date '2040-01-02', 540,
         variant.duration_minutes, variant.buffer_minutes, service.id, variant.id,
         service.display_name_it, variant.display_name_it, variant.price_cents,
         variant.currency, 'Bounded response privacy probe', $1::text,
         $2::text, statement_timestamp(), statement_timestamp(), 'migration',
         'synthetic privacy boundary fixture'
       from gioia_private.services as service
       join gioia_private.service_variants as variant
         on variant.service_id = service.id
       where service.id = $3::text and variant.id = $4::text
       returning client_email::text as client_email`,
      [
        privacyLeakProbe,
        `phase4-browser-privacy-${randomUUID()}`,
        ownerBookingTarget.serviceId,
        ownerBookingTarget.variantId,
      ],
    );
    expect(privacyProbeRows).toEqual([{ client_email: privacyLeakProbe }]);

    const noJavaScript = await browser.newContext({ javaScriptEnabled: false });
    const preHydrationLogin = await noJavaScript.newPage();
    await preHydrationLogin.goto("/login");
    await preHydrationLogin
      .getByLabel("Indirizzo email")
      .fill(LOCAL_SYNTHETIC_OWNER.email);
    await preHydrationLogin
      .getByLabel("Password")
      .fill(LOCAL_SYNTHETIC_OWNER.password);
    await preHydrationLogin.getByRole("button", { name: /^Accedi/u }).click();
    const preHydrationUrl = new URL(preHydrationLogin.url());
    expect(preHydrationUrl.pathname).toBe("/api/auth/login");
    expect(preHydrationUrl.search).toBe("");
    expect(preHydrationLogin.url()).not.toContain(
      encodeURIComponent(LOCAL_SYNTHETIC_OWNER.email),
    );
    expect(preHydrationLogin.url()).not.toContain(
      encodeURIComponent(LOCAL_SYNTHETIC_OWNER.password),
    );
    await noJavaScript.close();

    const anonymous = await browser.newContext();
    const anonymousResponse = await anonymous.request.get(
      "/api/admin/schedule?fromDate=2026-01-01&toDate=2026-01-31&pageSize=1",
    );
    expect(anonymousResponse.status()).toBe(401);
    expect(await anonymousResponse.text()).not.toMatch(
      /clientEmail|clientName|clientPhone/u,
    );
    await anonymous.close();

    const audit = startBrowserTrafficAudit(page);
    await loginOwnerThroughUi(page);
    await expect(page.getByText(/Totale mese:/u)).not.toContainText("...");
    await expect
      .poll(() =>
        [
          "/api/admin/schedule",
          "/api/admin/schedule/count",
          "/api/admin/vacations",
        ].every((path) => audit.requests.some((url) => url.pathname === path)),
      )
      .toBe(true);

    assertBoundedOwnerReads(audit);
    assertNoDirectBusinessTraffic(audit, localSupabaseOrigin);
    await audit.waitForResponses();
    expect(audit.responseBodies.join("\n")).not.toContain(privacyLeakProbe);
  });

  test("retries an ambiguous no-email dashboard booking with one idempotency key and soft-cancels it", async ({
    browser,
    localDatabase,
    localSupabaseOrigin,
    ownerBookingTarget,
    page,
  }) => {
    const marker = `Phase4 retry ${randomUUID()}`;
    const audit = startBrowserTrafficAudit(page);
    await loginOwnerThroughUi(page);
    const startMinutes = await availableStartMinutes(page, ownerBookingTarget);

    const idempotencyKeys: string[] = [];
    let intercepted = 0;
    await page.route("**/api/admin/appointments", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      intercepted += 1;
      idempotencyKeys.push(
        route.request().headers()["idempotency-key"] ?? "missing",
      );
      if (intercepted === 1) {
        const upstream = await route.fetch();
        expect(upstream.status()).toBe(201);
        await route.abort("connectionfailed");
        return;
      }
      await route.continue();
    });

    await createNoEmailAppointmentThroughUi(
      page,
      ownerBookingTarget,
      startMinutes,
      marker,
    );
    await expect(
      page.getByText("Appuntamento creato con successo!"),
    ).toBeVisible();
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
    const retryKey = idempotencyKeys[0];
    if (!retryKey)
      throw new Error("Dashboard idempotency key was not captured");
    await page.unroute("**/api/admin/appointments");

    const entries = await localDatabase.unsafe(
      `select id, version, status, client_email
       from gioia_private.schedule_entries
       where client_name = $1::text order by created_at desc limit 2`,
      [marker],
    );
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (!entry) throw new Error("Dashboard booking was not persisted");
    expect(entry).toMatchObject({
      client_email: null,
      status: "confirmed",
      version: 1,
    });
    const commands = await localDatabase.unsafe(
      `select count(*)::integer as count
       from gioia_private.command_requests
       where operation = 'owner_create_appointment'
         and idempotency_key = $1::text`,
      [retryKey],
    );
    expect(commands[0]?.count).toBe(1);

    const cancel = await browserOwnerCommand(
      page,
      "/api/admin/schedule/cancel",
      {
        entryId: entry.id,
        expectedVersion: 1,
        reason: null,
      },
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.code).toBe("SCHEDULE_ENTRY_CANCELLED");
    const cancelled = await localDatabase.unsafe(
      `select status, version, cancelled_by
       from gioia_private.schedule_entries where id = $1::uuid`,
      [entry.id],
    );
    expect(cancelled[0]).toMatchObject({
      cancelled_by: "admin",
      status: "cancelled",
      version: 2,
    });

    const anonymous = await browser.newContext();
    const leaked = await anonymous.request.get(
      `/api/admin/schedule?fromDate=${ownerBookingTarget.date}&toDate=${ownerBookingTarget.date}&pageSize=100`,
    );
    expect(leaked.status()).toBe(401);
    expect(await leaked.text()).not.toContain(marker);
    await anonymous.close();
    assertNoDirectBusinessTraffic(audit, localSupabaseOrigin);
  });

  test("rejects a revoked stale dashboard tab and returns both tabs to login", async ({
    context,
    localDatabase,
    ownerBookingTarget,
    page,
  }) => {
    await loginOwnerThroughUi(page);
    const staleTab = await context.newPage();
    await staleTab.goto("/dashboard");
    await expect(
      staleTab.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    const preRevocationSession = await staleTab.evaluate(async () => {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      return {
        body: (await response.json()) as Record<string, unknown>,
        status: response.status,
      };
    });
    expect(preRevocationSession.status).toBe(200);
    expect(preRevocationSession.body.csrfToken).toEqual(expect.any(String));
    const staleCsrfToken = String(preRevocationSession.body.csrfToken);

    const sessions = await localDatabase.unsafe(
      `select session_id from gioia_private.owner_sessions
       where revoked_at is null and expires_at > statement_timestamp()
       order by created_at desc limit 1`,
    );
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    if (!session) throw new Error("Owner session was not recorded");
    await localDatabase.unsafe(
      `update gioia_private.owner_sessions set revoked_at = statement_timestamp()
       where session_id = $1::uuid`,
      [session.session_id],
    );

    const staleMutationRequests: string[] = [];
    staleTab.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "POST" &&
        url.pathname === "/api/admin/appointments"
      ) {
        staleMutationRequests.push(url.pathname);
      }
    });
    const staleWrite = await browserOwnerCommand(
      staleTab,
      "/api/admin/appointments",
      {
        date: ownerBookingTarget.date,
        startMinutes: 540,
        serviceId: ownerBookingTarget.serviceId,
        variantId: ownerBookingTarget.variantId,
        clientName: "Revoked stale tab probe",
        clientEmail: null,
        clientPhone: null,
        clientNote: null,
      },
      undefined,
      undefined,
      staleCsrfToken,
    );
    expect(staleMutationRequests).toEqual(["/api/admin/appointments"]);
    expect(staleWrite.status).toBe(401);
    expect(staleWrite.body.code).toMatch(
      /OWNER_(SESSION|AUTHORIZATION)_(REQUIRED|REVOKED)/u,
    );
    await page.reload();
    await expect(page).toHaveURL(/\/login$/u);
    await expect(page.getByRole("button", { name: /^Accedi/u })).toBeVisible();
    await staleTab.reload();
    await expect(staleTab).toHaveURL(/\/login$/u);
  });

  test("rehearses freeze, audited canary cleanup, owner reconciliation, and unfreeze", async ({
    cutoverOperator,
    localDatabase,
    ownerBookingTarget,
    page,
  }) => {
    await loginOwnerThroughUi(page);
    const startMinutes = await availableStartMinutes(page, ownerBookingTarget);
    const freeze = await cutoverOperator.freeze("PHASE4_BROWSER_ACCEPTANCE");
    try {
      const frozenStatus = await page.request.get("/api/maintenance");
      expect(await frozenStatus.json()).toEqual({
        code: "MAINTENANCE_STATUS",
        messageCode: "MAINTENANCE_ACTIVE",
        ownerMutationsEnabled: false,
        publicBookingEnabled: false,
      });
      const ownerRead = await page.request.get(
        `/api/admin/schedule?fromDate=${ownerBookingTarget.date}&toDate=${ownerBookingTarget.date}&pageSize=1`,
      );
      expect(ownerRead.status()).toBe(200);

      await createNoEmailAppointmentThroughUi(
        page,
        ownerBookingTarget,
        startMinutes,
        "Frozen owner UI probe",
      );
      await expect(
        page.getByText(
          "Le modifiche sono temporaneamente sospese; la consultazione resta disponibile.",
        ),
      ).toBeVisible();
      const frozenRows = await localDatabase.unsafe(
        `select count(*)::integer as count from gioia_private.schedule_entries
       where client_name = 'Frozen owner UI probe'`,
      );
      expect(frozenRows[0]?.count).toBe(0);

      const publicBody = {
        date: ownerBookingTarget.date,
        startMinutes,
        serviceId: ownerBookingTarget.serviceId,
        variantId: ownerBookingTarget.variantId,
        clientName: "Frozen public probe",
        clientEmail: "frozen-public@gioia.test",
        clientPhone: "+390000000000",
        clientNote: null,
      };
      const blockedPublic = await browserPublicBooking(page, publicBody);
      expect(blockedPublic).toMatchObject({
        body: { code: "MAINTENANCE_ACTIVE" },
        retryAfter: "300",
        status: 503,
      });

      const run = await cutoverOperator.beginCanaryRun({
        freezeId: freeze.freezeId,
        labelCode: "PHASE4_BROWSER_CANARY",
        lifetimeSeconds: 600,
      });
      const canaryCreateBody = {
        date: ownerBookingTarget.date,
        startMinutes,
        serviceId: ownerBookingTarget.serviceId,
        variantId: ownerBookingTarget.variantId,
        clientName: "Synthetic canary browser probe",
        clientEmail: null,
        clientPhone: null,
        clientNote: null,
      };
      const createKey = randomUUID();
      const createGrant = await cutoverOperator.issueCanaryGrant({
        runId: run.runId,
        operation: "owner_create_appointment",
        idempotencyKey: createKey,
        requestFingerprint: ownerCommandFingerprint(
          "owner_create_appointment",
          canaryCreateBody,
        ),
      });
      const canaryCreated = await browserOwnerCommand(
        page,
        "/api/admin/appointments",
        canaryCreateBody,
        createKey,
        createGrant.token,
      );
      expect(canaryCreated.status).toBe(201);
      expect(canaryCreated.body.code).toBe("APPOINTMENT_CREATED");
      expect(canaryCreated.body.resourceId).toEqual(expect.any(String));
      const canaryId = String(canaryCreated.body.resourceId);

      const cancelBody = {
        entryId: canaryId,
        expectedVersion: 1,
        reason: "synthetic canary cleanup",
      };
      const cancelKey = randomUUID();
      const cancelGrant = await cutoverOperator.issueCanaryGrant({
        runId: run.runId,
        operation: "owner_cancel_schedule_entry",
        idempotencyKey: cancelKey,
        requestFingerprint: ownerCommandFingerprint(
          "owner_cancel_schedule_entry",
          cancelBody,
        ),
      });
      const canaryCancelled = await browserOwnerCommand(
        page,
        "/api/admin/schedule/cancel",
        cancelBody,
        cancelKey,
        cancelGrant.token,
      );
      expect(canaryCancelled.status).toBe(200);
      expect(canaryCancelled.body.code).toBe("SCHEDULE_ENTRY_CANCELLED");

      const canaryEvidence = await localDatabase.unsafe(
        `select
         (select count(*) from gioia_private.cutover_canary_events
          where run_id = $1::uuid)::integer as events,
         (select count(*) from gioia_private.email_outbox
          where aggregate_id = $2::uuid)::integer as outbox,
         (select status from gioia_private.schedule_entries
          where id = $2::uuid) as status`,
        [run.runId, canaryId],
      );
      expect(canaryEvidence[0]).toMatchObject({
        events: 2,
        outbox: 0,
        status: "cancelled",
      });
      await cutoverOperator.reconcileCanaryRun(run.runId);

      const reconcileVersion = await cutoverOperator.enterOwnerReconcile({
        freezeId: freeze.freezeId,
        expectedVersion: freeze.version,
        reasonCode: "PHASE4_MANUAL_LEDGER_RECONCILE",
      });
      const reconcileStatus = await page.request.get("/api/maintenance");
      expect(await reconcileStatus.json()).toMatchObject({
        messageCode: "OWNER_RECONCILIATION_ACTIVE",
        ownerMutationsEnabled: true,
        publicBookingEnabled: false,
      });
      const reconcilePublic = await browserPublicBooking(page, publicBody);
      expect(reconcilePublic.status).toBe(503);
      expect(reconcilePublic.body.code).toBe("MAINTENANCE_ACTIVE");

      const manualBody = {
        ...canaryCreateBody,
        clientName: "MAN-20260720-001 synthetic reconciliation",
      };
      const manual = await browserOwnerCommand(
        page,
        "/api/admin/appointments",
        manualBody,
      );
      expect(manual.status).toBe(201);
      const manualId = String(manual.body.resourceId);
      const manualCancel = await browserOwnerCommand(
        page,
        "/api/admin/schedule/cancel",
        { entryId: manualId, expectedVersion: 1, reason: "synthetic cleanup" },
      );
      expect(manualCancel.status).toBe(200);

      const unfreezeVersion = await cutoverOperator.unfreeze({
        freezeId: freeze.freezeId,
        expectedVersion: reconcileVersion,
        reasonCode: "PHASE4_BROWSER_ACCEPTED",
      });
      expect(unfreezeVersion).toBe(reconcileVersion + 1);
      const openStatus = await page.request.get("/api/maintenance");
      expect(await openStatus.json()).toEqual({
        code: "MAINTENANCE_STATUS",
        messageCode: "OPERATIONS_OPEN",
        ownerMutationsEnabled: true,
        publicBookingEnabled: true,
      });

      const transitions = await localDatabase.unsafe(
        `select from_mode, to_mode, reason_code
       from gioia_private.cutover_transition_log
       where freeze_id = $1::uuid order by sequence_id`,
        [freeze.freezeId],
      );
      expect(transitions).toEqual([
        {
          from_mode: "open",
          reason_code: "PHASE4_BROWSER_ACCEPTANCE",
          to_mode: "frozen",
        },
        {
          from_mode: "frozen",
          reason_code: "PHASE4_MANUAL_LEDGER_RECONCILE",
          to_mode: "owner_reconcile",
        },
        {
          from_mode: "owner_reconcile",
          reason_code: "PHASE4_BROWSER_ACCEPTED",
          to_mode: "open",
        },
      ]);
    } finally {
      await localDatabase.begin(async (transaction) => {
        const states = await transaction.unsafe(
          `select mode, freeze_id, version
           from gioia_private.cutover_write_control
           where singleton for update`,
        );
        const state = states[0];
        if (!state || state.mode === "open") return;
        if (state.freeze_id !== freeze.freezeId) {
          throw new Error("Unexpected Local cutover freeze during cleanup");
        }
        await transaction.unsafe(
          `update gioia_private.cutover_canary_grants as grant_row
           set status = 'revoked', revoked_at = statement_timestamp()
           from gioia_private.cutover_canary_runs as run
           where grant_row.run_id = run.id
             and run.freeze_id = $1::uuid
             and grant_row.status = 'issued'`,
          [freeze.freezeId],
        );
        await transaction.unsafe(
          `update gioia_private.cutover_canary_runs
           set status = 'reconciled', reconciled_at = statement_timestamp()
           where freeze_id = $1::uuid and status = 'active'`,
          [freeze.freezeId],
        );
        const nextVersion = Number(state.version) + 1;
        await transaction.unsafe(
          `update gioia_private.cutover_write_control
           set mode = 'open', freeze_id = null, version = $1::integer,
             reason_code = 'PHASE4_BROWSER_TEST_CLEANUP',
             changed_at = statement_timestamp()
           where singleton`,
          [nextVersion],
        );
        await transaction.unsafe(
          `insert into gioia_private.cutover_transition_log (
             freeze_id, from_mode, to_mode, control_version, reason_code
           ) values ($1::uuid, $2::text, 'open', $3::integer,
             'PHASE4_BROWSER_TEST_CLEANUP')`,
          [freeze.freezeId, state.mode, nextVersion],
        );
      });
    }
  });
});
