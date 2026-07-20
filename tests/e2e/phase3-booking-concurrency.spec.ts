import { randomUUID } from "node:crypto";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import {
  expect,
  test,
  type BookingTarget,
  type LocalDatabase,
} from "./phase3-api-fixture.ts";

const RACE_REQUESTS = 12;
const START_MINUTES = 600;
const HUMAN_CHALLENGE_TEST_TOKEN = "A".repeat(43);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface BookingBody {
  readonly date: string;
  readonly startMinutes: number;
  readonly serviceId: string;
  readonly variantId: string;
  readonly clientName: string;
  readonly clientEmail: string;
  readonly clientPhone: string;
  readonly clientNote: string;
}

function privateNoStore(response: APIResponse) {
  const cacheControl = response.headers()["cache-control"] ?? "";
  expect(cacheControl).toContain("private");
  expect(cacheControl).toContain("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
}

function bookingBody(
  target: BookingTarget,
  marker: string,
  clientEmail = "cliente.e2e@example.test",
): BookingBody {
  return {
    date: target.localDate,
    startMinutes: START_MINUTES,
    serviceId: target.serviceId,
    variantId: target.variantId,
    clientName: "Cliente E2E Sintetico",
    clientEmail,
    clientPhone: "+390000000000",
    clientNote: marker,
  };
}

function postBooking(
  request: APIRequestContext,
  body: BookingBody,
  idempotencyKey: string,
  origin: string | null,
  networkIp: string,
  humanChallengeToken?: string,
) {
  return request.post("/api/bookings", {
    data: body,
    headers: {
      "idempotency-key": idempotencyKey,
      "x-forwarded-for": networkIp,
      ...(origin ? { origin } : {}),
      ...(humanChallengeToken
        ? { "x-gioia-human-challenge": humanChallengeToken }
        : {}),
    },
  });
}

async function reconcileRace(
  database: LocalDatabase,
  marker: string,
  idempotencyKeys: readonly string[],
) {
  const [row] = await database.unsafe(
    `with appointments as (
       select id from gioia_private.schedule_entries where client_note = $1
     ), commands as (
       select state from gioia_private.command_requests
       where operation = 'public_booking'
         and idempotency_key = any($2::text[])
     )
     select
       (select count(*)::integer from appointments) as appointments,
       (select count(*)::integer from commands) as command_rows,
       (select count(*)::integer from commands where state = 'completed')
         as completed_commands,
       (select count(*)::integer from commands where state = 'failed')
         as failed_commands,
       (select count(*)::integer from gioia_private.domain_change_log
        where aggregate_id in (select id from appointments)) as domain_changes,
       (select count(*)::integer from gioia_private.email_outbox
        where aggregate_id in (select id from appointments)) as outbox_rows`,
    [marker, idempotencyKeys],
  );
  return row;
}

test("real HTTP booking remains bounded, idempotent, and concurrency-safe", async ({
  bookingTarget,
  baseURL,
  localDatabase,
  request,
}) => {
  expect(baseURL).toBeDefined();
  const origin = null;
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  expect(health.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  privateNoStore(health);

  const query = new URLSearchParams({
    date: bookingTarget.localDate,
    serviceId: bookingTarget.serviceId,
    variantId: bookingTarget.variantId,
  });
  const availability = await request.get(`/api/availability?${query}`);
  expect(availability.status(), await availability.text()).toBe(200);
  privateNoStore(availability);
  const available = (await availability.json()) as {
    date: string;
    serviceId: string;
    variantId: string;
    slots: number[];
  };
  expect(available).toMatchObject({
    date: bookingTarget.localDate,
    serviceId: bookingTarget.serviceId,
    variantId: bookingTarget.variantId,
  });
  expect(available.slots.length).toBeLessThanOrEqual(96);
  expect(available.slots).toContain(START_MINUTES);
  expect(JSON.stringify(available)).not.toContain("example.test");

  const marker = `phase3-http-race-${randomUUID()}`;
  const idempotencyKeys = Array.from({ length: RACE_REQUESTS }, () =>
    randomUUID(),
  );
  const bodies = Array.from({ length: RACE_REQUESTS }, (_value, index) =>
    bookingBody(
      bookingTarget,
      marker,
      `cliente.e2e.race.${index}@example.test`,
    ),
  );
  // Distinct TEST-NET/account principals keep this case focused on the
  // database overlap invariant. The explicit synthetic proof satisfies the
  // Local/Test-only account challenge without bypassing either hard limit.
  const networkIps = Array.from(
    { length: RACE_REQUESTS },
    (_value, index) => `192.0.2.${31 + index}`,
  );
  const responses = await Promise.all(
    idempotencyKeys.map((key, index) =>
      postBooking(
        request,
        bodies[index]!,
        key,
        origin,
        networkIps[index]!,
        HUMAN_CHALLENGE_TEST_TOKEN,
      ),
    ),
  );
  const statuses = responses.map((response) => response.status());
  const responseBodies = await Promise.all(
    responses.map((response) => response.text()),
  );
  expect(
    statuses.filter((status) => status === 201),
    JSON.stringify({ statuses, responseBodies }),
  ).toHaveLength(1);
  expect(statuses.filter((status) => status === 409)).toHaveLength(
    RACE_REQUESTS - 1,
  );
  responses.forEach(privateNoStore);

  const winnerIndex = statuses.indexOf(201);
  const winnerKey = idempotencyKeys[winnerIndex];
  const winnerIp = networkIps[winnerIndex];
  const winnerBody = bodies[winnerIndex];
  expect(winnerKey).toBeDefined();
  expect(winnerIp).toBeDefined();
  expect(winnerBody).toBeDefined();
  const winner = (await responses[winnerIndex]!.json()) as Record<
    string,
    unknown
  >;
  expect(winner).toEqual({
    code: "BOOKING_CREATED",
    resourceId: expect.stringMatching(UUID),
    replayed: false,
  });
  for (const [index, response] of responses.entries()) {
    if (index === winnerIndex) continue;
    expect(await response.json()).toMatchObject({ code: "SLOT_UNAVAILABLE" });
  }

  const expectedReconciliation = {
    appointments: 1,
    command_rows: RACE_REQUESTS,
    completed_commands: 1,
    failed_commands: RACE_REQUESTS - 1,
    domain_changes: 1,
    outbox_rows: 2,
  };
  expect(await reconcileRace(localDatabase, marker, idempotencyKeys)).toEqual(
    expectedReconciliation,
  );

  const replay = await postBooking(
    request,
    winnerBody!,
    winnerKey!,
    origin,
    winnerIp!,
    HUMAN_CHALLENGE_TEST_TOKEN,
  );
  expect(replay.status()).toBe(201);
  privateNoStore(replay);
  expect(await replay.json()).toEqual({ ...winner, replayed: true });

  const changedReplay = await postBooking(
    request,
    { ...winnerBody!, clientNote: `${marker}-changed` },
    winnerKey!,
    origin,
    winnerIp!,
    HUMAN_CHALLENGE_TEST_TOKEN,
  );
  expect(changedReplay.status()).toBe(409);
  privateNoStore(changedReplay);
  expect(await changedReplay.json()).toMatchObject({
    code: "IDEMPOTENCY_KEY_REUSED",
  });
  expect(await reconcileRace(localDatabase, marker, idempotencyKeys)).toEqual(
    expectedReconciliation,
  );

  const afterBooking = await request.get(`/api/availability?${query}`);
  expect(afterBooking.status()).toBe(200);
  const remaining = (await afterBooking.json()) as { slots: number[] };
  expect(remaining.slots).not.toContain(START_MINUTES);
});
