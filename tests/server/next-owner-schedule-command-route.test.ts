import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as appointmentRoute from "@/app/api/admin/appointments/route.ts";
import * as appointmentDetailsRoute from "@/app/api/admin/appointments/details/route.ts";
import * as appointmentRescheduleRoute from "@/app/api/admin/appointments/reschedule/route.ts";
import * as appointmentStatusRoute from "@/app/api/admin/appointments/status/route.ts";
import * as blockRoute from "@/app/api/admin/blocks/route.ts";
import * as blockDetailsRoute from "@/app/api/admin/blocks/details/route.ts";
import * as blockRescheduleRoute from "@/app/api/admin/blocks/reschedule/route.ts";
import * as scheduleCancelRoute from "@/app/api/admin/schedule/cancel/route.ts";
import * as vacationCancelRoute from "@/app/api/admin/vacations/cancel/route.ts";
import * as vacationRoute from "@/app/api/admin/vacations/route.ts";
import { requestFingerprint } from "@/lib/server/bookingSecurity.ts";
import type {
  OwnerScheduleCommandResult,
  OwnerScheduleRepository,
} from "@/lib/server/database/ownerScheduleRepository.ts";
import {
  createNextOwnerScheduleCommandRoute,
  type NextOwnerScheduleCommandRouteDependencies,
} from "@/lib/server/nextOwnerScheduleCommandRoute.ts";
import {
  now,
  secret,
  sessionId,
  setup,
  userId,
} from "./fresh-owner-session-fixture.ts";
import {
  OWNER_ROUTE_COMMAND_CASES as commandCases,
  RESOURCE_ID,
} from "./next-owner-schedule-command-route-cases.ts";

const CSRF_TOKEN = "A".repeat(43);
const IDEMPOTENCY_KEY = "30000000-0000-4000-8000-000000000001";

function success(
  httpStatus: 200 | 201,
  code: string,
): OwnerScheduleCommandResult {
  return {
    http_status: httpStatus,
    result: { code, resource_id: RESOURCE_ID },
    replayed: false,
  };
}

function repositoryFixture() {
  return {
    createAppointment: vi.fn(async () => success(201, "APPOINTMENT_CREATED")),
    createBlock: vi.fn(async () => success(201, "BLOCK_CREATED")),
    updateAppointment: vi.fn(async () =>
      success(200, "APPOINTMENT_DETAILS_UPDATED"),
    ),
    updateBlock: vi.fn(async () => success(200, "BLOCK_DETAILS_UPDATED")),
    rescheduleAppointment: vi.fn(async () =>
      success(200, "APPOINTMENT_RESCHEDULED"),
    ),
    rescheduleBlock: vi.fn(async () => success(200, "BLOCK_RESCHEDULED")),
    setAppointmentStatus: vi.fn(async () =>
      success(200, "APPOINTMENT_STATUS_UPDATED"),
    ),
    cancelScheduleEntry: vi.fn(async () =>
      success(200, "SCHEDULE_ENTRY_CANCELLED"),
    ),
    createVacation: vi.fn(async () => success(201, "VACATION_CREATED")),
    updateVacation: vi.fn(async () => success(200, "VACATION_UPDATED")),
    cancelVacation: vi.fn(async () => success(200, "VACATION_CANCELLED")),
  } satisfies OwnerScheduleRepository;
}

function routeDependencies(repository: OwnerScheduleRepository) {
  const authFixture = setup();
  const createAuthContext = vi.fn(async () => ({
    auth: {
      ...authFixture.auth,
      signOut: vi.fn(async () => ({ error: null })),
    } as never,
    responseHeaders: new Headers(),
    securityCookieStore: { get: vi.fn(), set: vi.fn() },
    secure: false,
  }));
  const readSecurityTokens = vi.fn(async () => ({
    bindingToken: authFixture.bindingToken,
    csrfToken: CSRF_TOKEN,
  }));
  const dependencies = {
    repository,
    writeGate: {
      check: vi.fn(async () => ({
        ok: true as const,
        canaryToken: null,
        mode: "open" as const,
      })),
    },
    createAuthContext,
    readSecurityTokens,
    getBindingSecret: () => secret,
    createRequestId: () => "50000000-0000-4000-8000-000000000001",
    now,
  } satisfies NextOwnerScheduleCommandRouteDependencies;
  return { createAuthContext, dependencies, readSecurityTokens };
}

function commandRequest(
  path: string,
  body: unknown,
  {
    csrfToken = CSRF_TOKEN,
    idempotencyKey = IDEMPOTENCY_KEY,
  }: { csrfToken?: string; idempotencyKey?: string | null } = {},
) {
  const headers = new Headers({
    host: "preview.example.test",
    origin: "https://preview.example.test",
    "content-type": "application/json",
    "x-csrf-token": csrfToken,
  });
  if (idempotencyKey !== null) {
    headers.set("idempotency-key", idempotencyKey);
  }
  return new Request(`https://preview.example.test${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const commandNames = commandCases.map(({ commandName }) => commandName);
const versionedCommandCases = commandCases.filter(
  ({ body }) => "expectedVersion" in body,
);

describe("Next owner schedule command route adapter", () => {
  it.each([
    [
      "mismatched CSRF",
      { csrfToken: "B".repeat(43) },
      commandCases[0].body,
      403,
    ],
    [
      "missing idempotency",
      { idempotencyKey: null },
      commandCases[0].body,
      400,
    ],
    ["invalid body", {}, {}, 422],
  ] as const)(
    "rejects %s before Auth context or repository work",
    async (_label, requestOptions, body, status) => {
      const repository = repositoryFixture();
      const fixture = routeDependencies(repository);
      const response = await createNextOwnerScheduleCommandRoute(
        "createAppointment",
        fixture.dependencies,
      )(commandRequest("/api/admin/appointments", body, requestOptions));

      expect(response.status).toBe(status);
      expect(fixture.readSecurityTokens).toHaveBeenCalledOnce();
      expect(fixture.createAuthContext).not.toHaveBeenCalled();
      for (const commandName of commandNames) {
        expect(repository[commandName]).not.toHaveBeenCalled();
      }
    },
  );

  it.each(commandCases)(
    "rejects a competing $commandName query before body, Auth, or repository work",
    async ({ commandName, path }) => {
      const repository = repositoryFixture();
      const fixture = routeDependencies(repository);
      const request = commandRequest(`${path}?unexpected=1`, "{not-json");
      const getReader = vi.spyOn(request.body!, "getReader");

      const response = await createNextOwnerScheduleCommandRoute(
        commandName,
        fixture.dependencies,
      )(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: "INVALID_REQUEST",
        requestId: "50000000-0000-4000-8000-000000000001",
      });
      expect(fixture.readSecurityTokens).toHaveBeenCalledOnce();
      expect(fixture.createAuthContext).not.toHaveBeenCalled();
      expect(getReader).not.toHaveBeenCalled();
      for (const commandName of commandNames) {
        expect(repository[commandName]).not.toHaveBeenCalled();
      }
    },
  );

  it.each(versionedCommandCases)(
    "rejects an invalid PostgreSQL version for $commandName before Auth or repository work",
    async ({ commandName, path, body }) => {
      for (const expectedVersion of [0, 2_147_483_648]) {
        const repository = repositoryFixture();
        const fixture = routeDependencies(repository);
        const response = await createNextOwnerScheduleCommandRoute(
          commandName,
          fixture.dependencies,
        )(
          commandRequest(path, {
            ...body,
            expectedVersion,
          }),
        );

        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({
          code: "INVALID_REQUEST",
          requestId: "50000000-0000-4000-8000-000000000001",
        });
        expect(fixture.readSecurityTokens).toHaveBeenCalledOnce();
        expect(fixture.createAuthContext).not.toHaveBeenCalled();
        for (const repositoryCommandName of commandNames) {
          expect(repository[repositoryCommandName]).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each(versionedCommandCases)(
    "accepts the PostgreSQL version maximum for $commandName",
    async ({ commandName, path, body, status, code }) => {
      const repository = repositoryFixture();
      const fixture = routeDependencies(repository);
      const response = await createNextOwnerScheduleCommandRoute(
        commandName,
        fixture.dependencies,
      )(
        commandRequest(path, {
          ...body,
          expectedVersion: 2_147_483_647,
        }),
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
      expect(fixture.createAuthContext).toHaveBeenCalledOnce();
      expect(repository[commandName]).toHaveBeenCalledWith(
        { userId, sessionId },
        expect.objectContaining({ expectedVersion: 2_147_483_647 }),
        expect.any(Buffer),
        null,
      );
    },
  );

  it.each(commandCases)(
    "wires $commandName with its normalized body and fingerprint domain",
    async ({
      commandName,
      path,
      operation,
      status,
      code,
      body,
      normalizedBody,
    }) => {
      const repository = repositoryFixture();
      const fixture = routeDependencies(repository);
      const request = commandRequest(path, body);
      const response = await createNextOwnerScheduleCommandRoute(
        commandName,
        fixture.dependencies,
      )(request);

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        code,
        resourceId: RESOURCE_ID,
        replayed: false,
      });
      expect(fixture.createAuthContext).toHaveBeenCalledWith(request);
      expect(repository[commandName]).toHaveBeenCalledWith(
        { userId, sessionId },
        { ...normalizedBody, idempotencyKey: IDEMPOTENCY_KEY },
        requestFingerprint({ operation, version: 1, request: normalizedBody }),
        null,
      );
      for (const otherName of commandNames) {
        expect(repository[otherName]).toHaveBeenCalledTimes(
          otherName === commandName ? 1 : 0,
        );
      }
    },
  );
});

describe("owner schedule command route modules", () => {
  it.each([
    ["appointments", appointmentRoute],
    ["appointment details", appointmentDetailsRoute],
    ["appointment reschedule", appointmentRescheduleRoute],
    ["appointment status", appointmentStatusRoute],
    ["blocks", blockRoute],
    ["block details", blockDetailsRoute],
    ["block reschedule", blockRescheduleRoute],
    ["schedule cancellation", scheduleCancelRoute],
    ["vacations", vacationRoute],
    ["vacation cancellation", vacationCancelRoute],
  ])("exports a dynamic Node POST for %s", (_label, route) => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    expect(route.POST).toEqual(expect.any(Function));
  });
});
