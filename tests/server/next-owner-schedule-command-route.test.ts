import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as appointmentRoute from "@/app/api/admin/appointments/route.ts";
import * as blockRoute from "@/app/api/admin/blocks/route.ts";
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

const CSRF_TOKEN = "A".repeat(43);
const IDEMPOTENCY_KEY = "30000000-0000-4000-8000-000000000001";
const RESOURCE_ID = "40000000-0000-4000-8000-000000000001";

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
    cancelScheduleEntry: vi.fn(async () =>
      success(200, "SCHEDULE_ENTRY_CANCELLED"),
    ),
    createVacation: vi.fn(async () => success(201, "VACATION_CREATED")),
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

const commandCases = [
  {
    commandName: "createAppointment",
    path: "/api/admin/appointments",
    operation: "owner_create_appointment",
    status: 201,
    code: "APPOINTMENT_CREATED",
    body: {
      date: "2035-01-02",
      startMinutes: 600,
      serviceId: "massaggio-relax",
      variantId: "massaggio-relax-60",
      clientName: " Cliente Test ",
      clientEmail: " CLIENT@example.test ",
      clientPhone: "+39 333 123 4567",
    },
    normalizedBody: {
      date: "2035-01-02",
      startMinutes: 600,
      serviceId: "massaggio-relax",
      variantId: "massaggio-relax-60",
      clientName: "Cliente Test",
      clientEmail: "client@example.test",
      clientPhone: "+393331234567",
      clientNote: null,
    },
  },
  {
    commandName: "createBlock",
    path: "/api/admin/blocks",
    operation: "owner_create_block",
    status: 201,
    code: "BLOCK_CREATED",
    body: {
      date: "2035-01-02",
      startMinutes: 720,
      durationMinutes: 30,
      internalNote: " Pausa ",
    },
    normalizedBody: {
      date: "2035-01-02",
      startMinutes: 720,
      durationMinutes: 30,
      bufferMinutes: 0,
      internalNote: "Pausa",
    },
  },
  {
    commandName: "cancelScheduleEntry",
    path: "/api/admin/schedule/cancel",
    operation: "owner_cancel_schedule_entry",
    status: 200,
    code: "SCHEDULE_ENTRY_CANCELLED",
    body: {
      entryId: RESOURCE_ID,
      expectedVersion: 2,
      reason: " Richiesta cliente ",
    },
    normalizedBody: {
      entryId: RESOURCE_ID,
      expectedVersion: 2,
      reason: "Richiesta cliente",
    },
  },
  {
    commandName: "createVacation",
    path: "/api/admin/vacations",
    operation: "owner_create_vacation",
    status: 201,
    code: "VACATION_CREATED",
    body: {
      startDate: "2035-02-01",
      endDate: "2035-02-05",
      reason: " Ferie ",
    },
    normalizedBody: {
      startDate: "2035-02-01",
      endDate: "2035-02-05",
      reason: "Ferie",
    },
  },
  {
    commandName: "cancelVacation",
    path: "/api/admin/vacations/cancel",
    operation: "owner_cancel_vacation",
    status: 200,
    code: "VACATION_CANCELLED",
    body: { vacationId: RESOURCE_ID, expectedVersion: 3 },
    normalizedBody: { vacationId: RESOURCE_ID, expectedVersion: 3 },
  },
] as const;

const commandNames = commandCases.map(({ commandName }) => commandName);

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
    ["blocks", blockRoute],
    ["schedule cancellation", scheduleCancelRoute],
    ["vacations", vacationRoute],
    ["vacation cancellation", vacationCancelRoute],
  ])("exports a dynamic Node POST for %s", (_label, route) => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    expect(route.POST).toEqual(expect.any(Function));
  });
});
