const CATALOG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_KEY = /^[A-Za-z0-9._:-]{8,255}$/;
const SAFE_TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_BYTE = /^[0-9a-f]{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REQUEST_COUNT = 20;
export const OWNER_ID = "d0000000-0000-4000-8000-000000000001";
export const OWNER_SESSION_ID = "d1000000-0000-4000-8000-000000000001";
const OWNER_AUTH_CONTEXT =
  `case when set_config('request.jwt.claim.session_id', ` +
  `'${OWNER_SESSION_ID}', true) <> '' then ` +
  `set_config('request.jwt.claim.sub', '${OWNER_ID}', true)::uuid end`;

export const ownerFixtureQueries = [
  `insert into auth.users (
    instance_id, id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    '${OWNER_ID}', 'authenticated', 'authenticated',
    'owner@concurrency.test', statement_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, statement_timestamp(), statement_timestamp()
  ) on conflict (id) do nothing`,
  `insert into gioia_private.owner_accounts (user_id)
  values ('${OWNER_ID}') on conflict (user_id) do nothing`,
  `insert into gioia_private.owner_sessions (
    session_id, user_id, created_at, expires_at
  ) values (
    '${OWNER_SESSION_ID}', '${OWNER_ID}', statement_timestamp(),
    statement_timestamp() + interval '12 hours'
  ) on conflict (session_id) do nothing`,
];

export const raceTargetQuery = `
  with target_variant as (
    select service.id as service_id, variant.id as variant_id,
      variant.duration_minutes, variant.buffer_minutes
    from gioia_private.service_variants as variant
    join gioia_private.services as service on service.id = variant.service_id
    join gioia_private.service_categories as category
      on category.id = service.category_id
    where variant.active and service.active and category.active
    order by variant.duration_minutes + variant.buffer_minutes,
      service.id, variant.id
    limit 1
  ), target_dates as (
    select (
      (statement_timestamp() at time zone 'Europe/Rome')::date + candidate.days
    )::date as local_date
    from pg_catalog.generate_series(1, 14) as candidate(days)
    where exists (
      select 1 from gioia_private.business_hours as hours
      cross join target_variant
      where hours.weekday = extract(
        isodow from (
          statement_timestamp() at time zone 'Europe/Rome'
        )::date + candidate.days
      )::smallint
        and hours.opens_at_minutes <= 600
        and 600 + target_variant.duration_minutes
          + target_variant.buffer_minutes <= hours.closes_at_minutes
    )
      and not exists (
        select 1 from gioia_private.vacations as vacation
        where vacation.status = 'active'
          and vacation.date_span @> (
            (statement_timestamp() at time zone 'Europe/Rome')::date
              + candidate.days
          )::date
      )
      and not exists (
        select 1 from gioia_private.schedule_entries as entry
        where entry.local_date = (
          (statement_timestamp() at time zone 'Europe/Rome')::date
            + candidate.days
        )::date
          and entry.status in ('confirmed', 'completed', 'active')
      )
    order by candidate.days
    limit 5
  ), numbered_dates as (
    select row_number() over (order by local_date)::integer as scenario_index,
      local_date
    from target_dates
  )
  select numbered_dates.scenario_index,
    numbered_dates.local_date::text as local_date,
    target_variant.service_id, target_variant.variant_id
  from numbered_dates cross join target_variant
  order by numbered_dates.scenario_index
`;

export function parseRaceTarget(row) {
  const localDate = String(row?.local_date ?? "");
  const serviceId = String(row?.service_id ?? "");
  const variantId = String(row?.variant_id ?? "");
  if (
    !LOCAL_DATE.test(localDate) ||
    !CATALOG_ID.test(serviceId) ||
    !CATALOG_ID.test(variantId)
  ) {
    throw new Error("Concurrency target query returned invalid identifiers");
  }
  return { localDate, serviceId, variantId };
}

export function parseRaceTargets(rows) {
  if (!Array.isArray(rows) || rows.length !== 5) {
    throw new Error("Concurrency target query must return five dates");
  }
  const targets = rows.map((row, index) => {
    if (Number(row?.scenario_index) !== index + 1) {
      throw new Error("Concurrency target indices are not deterministic");
    }
    return parseRaceTarget(row);
  });
  if (new Set(targets.map((target) => target.localDate)).size !== 5) {
    throw new Error("Concurrency target dates must be distinct");
  }
  if (
    targets.some(
      (target) =>
        target.serviceId !== targets[0].serviceId ||
        target.variantId !== targets[0].variantId,
    )
  ) {
    throw new Error("Concurrency targets must use one catalog variant");
  }
  return targets;
}

function assertCommandParts({
  idempotencyKey,
  fixtureTag,
  principalByte,
  fingerprintByte,
}) {
  if (
    !SAFE_KEY.test(idempotencyKey) ||
    !SAFE_TAG.test(fixtureTag) ||
    !HEX_BYTE.test(principalByte) ||
    !HEX_BYTE.test(fingerprintByte)
  ) {
    throw new Error("Concurrency query received unsafe command parts");
  }
}

export function publicBookingQuery(
  target,
  { idempotencyKey, fixtureTag, principalByte, fingerprintByte },
) {
  const safeTarget = parseRaceTarget({
    local_date: target.localDate,
    service_id: target.serviceId,
    variant_id: target.variantId,
  });
  assertCommandParts({
    idempotencyKey,
    fixtureTag,
    principalByte,
    fingerprintByte,
  });
  return `
    select booking.http_status, booking.result ->> 'code' as code,
      booking.replayed
    from gioia_private.create_public_booking(
      decode(repeat('${principalByte}', 32), 'hex'),
      '${idempotencyKey}', decode(repeat('${fingerprintByte}', 32), 'hex'),
      '${safeTarget.localDate}'::date, 600::smallint,
      '${safeTarget.serviceId}', '${safeTarget.variantId}',
      'Synthetic Concurrency', '${fixtureTag}@example.test',
      '+390000000000', 'synthetic-${fixtureTag}'
    ) as booking
  `;
}

export function bookingQuery(requestNumber, target) {
  const sequence = String(requestNumber).padStart(2, "0");
  return publicBookingQuery(target, {
    idempotencyKey: `race-distinct-${sequence}`,
    fixtureTag: "distinct-key-race",
    principalByte: "11",
    fingerprintByte: "21",
  });
}

export function identicalBookingQuery(target) {
  return publicBookingQuery(target, {
    idempotencyKey: "race-identical-key",
    fixtureTag: "identical-key-race",
    principalByte: "12",
    fingerprintByte: "22",
  });
}

export function bookingVacationBookingQuery(target) {
  return publicBookingQuery(target, {
    idempotencyKey: "race-booking-vacation-book",
    fixtureTag: "booking-vacation-race",
    principalByte: "13",
    fingerprintByte: "23",
  });
}

export function bookingVacationVacationQuery(target) {
  const { localDate } = parseRaceTarget({
    local_date: target.localDate,
    service_id: target.serviceId,
    variant_id: target.variantId,
  });
  return `
    select vacation.http_status, vacation.result ->> 'code' as code,
      vacation.replayed
    from gioia_private.owner_create_vacation(
      ${OWNER_AUTH_CONTEXT}, 'race-booking-vacation-close',
      decode(repeat('33', 32), 'hex'),
      '${localDate}'::date, '${localDate}'::date,
      'Synthetic booking vacation race'
    ) as vacation
  `;
}

export function ownerCreateAppointmentQuery(target, suffix, fingerprintByte) {
  if (!new Set(["a", "b"]).has(suffix) || !HEX_BYTE.test(fingerprintByte)) {
    throw new Error("Invalid owner appointment fixture selector");
  }
  const safeTarget = parseRaceTarget({
    local_date: target.localDate,
    service_id: target.serviceId,
    variant_id: target.variantId,
  });
  return `
    select command.http_status, command.result ->> 'code' as code,
      command.result ->> 'resource_id' as resource_id, command.replayed
    from gioia_private.owner_create_appointment(
      ${OWNER_AUTH_CONTEXT}, 'race-swap-create-${suffix}',
      decode(repeat('${fingerprintByte}', 32), 'hex'),
      '${safeTarget.localDate}'::date, 600::smallint,
      '${safeTarget.serviceId}', '${safeTarget.variantId}',
      'Synthetic Swap ${suffix.toUpperCase()}',
      'swap-${suffix}@example.test', null,
      'synthetic-reschedule-swap-${suffix}'
    ) as command
  `;
}

export function ownerRescheduleQuery({
  entryId,
  target,
  suffix,
  fingerprintByte,
}) {
  if (
    !UUID.test(entryId) ||
    !new Set(["a", "b"]).has(suffix) ||
    !HEX_BYTE.test(fingerprintByte)
  ) {
    throw new Error("Invalid opposite-reschedule command parts");
  }
  const safeTarget = parseRaceTarget({
    local_date: target.localDate,
    service_id: target.serviceId,
    variant_id: target.variantId,
  });
  return `
    select command.http_status, command.result ->> 'code' as code,
      command.replayed
    from gioia_private.owner_reschedule_appointment(
      ${OWNER_AUTH_CONTEXT}, 'race-swap-reschedule-${suffix}',
      decode(repeat('${fingerprintByte}', 32), 'hex'),
      '${entryId}', 1, '${safeTarget.localDate}'::date, 600::smallint,
      '${safeTarget.serviceId}', '${safeTarget.variantId}'
    ) as command
  `;
}
