begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.rome_today()
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select (pg_catalog.statement_timestamp() at time zone 'Europe/Rome')::date
$$;

create function gioia_private.resolve_active_variant(
  p_service_id text,
  p_variant_id text
)
returns table (
  duration_minutes smallint,
  buffer_minutes smallint,
  service_name text,
  variant_name text,
  price_cents integer,
  currency character(3)
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return query
  select
    variant.duration_minutes,
    variant.buffer_minutes,
    service.display_name_it,
    variant.display_name_it,
    variant.price_cents,
    variant.currency
  from gioia_private.service_variants as variant
  join gioia_private.services as service on service.id = variant.service_id
  join gioia_private.service_categories as category on category.id = service.category_id
  where service.id = p_service_id
    and variant.id = p_variant_id
    and variant.active
    and service.active
    and category.active;

  if not found then
    raise sqlstate 'PT404' using message = 'ACTIVE_VARIANT_NOT_FOUND';
  end if;
end;
$$;

create function gioia_private.assert_interval_open(
  p_local_date date,
  p_start_minutes smallint,
  p_duration_minutes smallint,
  p_buffer_minutes smallint
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_end_minutes integer;
begin
  if p_local_date is null
    or p_start_minutes is null
    or p_duration_minutes is null
    or p_buffer_minutes is null
    or p_start_minutes not between 0 and 1439
    or p_duration_minutes not between 1 and 480
    or p_buffer_minutes not between 0 and 120 then
    raise sqlstate 'PT400' using message = 'SCHEDULE_INTERVAL_INVALID';
  end if;

  v_end_minutes := p_start_minutes + p_duration_minutes + p_buffer_minutes;
  if v_end_minutes > 1440 or not exists (
    select 1
    from gioia_private.business_hours as hours
    where hours.weekday = extract(isodow from p_local_date)::smallint
      and p_start_minutes >= hours.opens_at_minutes
      and v_end_minutes <= hours.closes_at_minutes
  ) then
    raise sqlstate 'PT409' using message = 'SLOT_OUTSIDE_BUSINESS_HOURS';
  end if;
end;
$$;

create function gioia_private.assert_public_slot_policy(
  p_local_date date,
  p_start_minutes smallint
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_policy gioia_private.booking_policy%rowtype;
  v_today date;
  v_start_at timestamptz;
begin
  select policy.* into strict v_policy
  from gioia_private.booking_policy as policy
  where policy.singleton;
  v_today := gioia_private.rome_today();

  if p_local_date is null or p_start_minutes is null
    or p_start_minutes not between 0 and 1439 then
    raise sqlstate 'PT400' using message = 'PUBLIC_SLOT_INVALID';
  end if;
  if p_local_date <= v_today then
    raise sqlstate 'PT400' using message = 'PUBLIC_DATE_TOO_EARLY';
  end if;
  if p_local_date - v_today > v_policy.public_max_advance_days then
    raise sqlstate 'PT400' using message = 'PUBLIC_DATE_TOO_LATE';
  end if;
  if p_start_minutes % v_policy.slot_alignment_minutes <> 0 then
    raise sqlstate 'PT400' using message = 'SLOT_ALIGNMENT_INVALID';
  end if;

  v_start_at := (
    p_local_date::timestamp
      + pg_catalog.make_interval(mins => p_start_minutes)
  ) at time zone v_policy.timezone;
  if v_start_at - pg_catalog.statement_timestamp()
    < pg_catalog.make_interval(mins => v_policy.public_min_lead_minutes) then
    raise sqlstate 'PT400' using message = 'PUBLIC_LEAD_TIME_INVALID';
  end if;
end;
$$;

create function gioia_private.assert_owner_slot_policy(
  p_local_date date,
  p_start_minutes smallint
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_policy gioia_private.booking_policy%rowtype;
  v_start_at timestamptz;
begin
  select policy.* into strict v_policy
  from gioia_private.booking_policy as policy
  where policy.singleton;

  if p_local_date is null or p_start_minutes is null
    or p_start_minutes not between 0 and 1439 then
    raise sqlstate 'PT400' using message = 'OWNER_SLOT_INVALID';
  end if;
  if p_local_date < gioia_private.rome_today() then
    raise sqlstate 'PT400' using message = 'OWNER_DATE_IN_PAST';
  end if;
  if p_start_minutes % v_policy.slot_alignment_minutes <> 0 then
    raise sqlstate 'PT400' using message = 'SLOT_ALIGNMENT_INVALID';
  end if;

  v_start_at := (
    p_local_date::timestamp
      + pg_catalog.make_interval(mins => p_start_minutes)
  ) at time zone v_policy.timezone;
  if v_start_at < pg_catalog.statement_timestamp() then
    raise sqlstate 'PT400' using message = 'OWNER_START_IN_PAST';
  end if;
end;
$$;

create function gioia_private.get_public_availability(
  p_local_date date,
  p_service_id text,
  p_variant_id text
)
returns table (start_minutes smallint)
language plpgsql
stable
security definer
set search_path = ''
rows 96
as $$
declare
  v_variant record;
  v_policy gioia_private.booking_policy%rowtype;
  v_today date;
begin
  select * into strict v_variant
  from gioia_private.resolve_active_variant(p_service_id, p_variant_id);
  select policy.* into strict v_policy
  from gioia_private.booking_policy as policy
  where policy.singleton;
  v_today := gioia_private.rome_today();

  if p_local_date is null or p_local_date <= v_today then
    raise sqlstate 'PT400' using message = 'PUBLIC_DATE_TOO_EARLY';
  end if;
  if p_local_date - v_today > v_policy.public_max_advance_days then
    raise sqlstate 'PT400' using message = 'PUBLIC_DATE_TOO_LATE';
  end if;

  return query
  select candidate.value::smallint
  from gioia_private.business_hours as hours
  cross join lateral pg_catalog.generate_series(
    (
      (hours.opens_at_minutes::integer
        + v_policy.slot_alignment_minutes::integer - 1)
      / v_policy.slot_alignment_minutes::integer
    ) * v_policy.slot_alignment_minutes::integer,
    hours.closes_at_minutes::integer
      - v_variant.duration_minutes::integer
      - v_variant.buffer_minutes::integer,
    v_policy.slot_alignment_minutes::integer
  ) as candidate(value)
  where hours.weekday = extract(isodow from p_local_date)::smallint
    and (
      (
        p_local_date::timestamp
          + pg_catalog.make_interval(mins => candidate.value)
      ) at time zone v_policy.timezone
    ) - pg_catalog.statement_timestamp()
      >= pg_catalog.make_interval(mins => v_policy.public_min_lead_minutes)
    and not exists (
      select 1
      from gioia_private.vacations as vacation
      where vacation.status = 'active'
        and vacation.date_span @> p_local_date
    )
    and not exists (
      select 1
      from gioia_private.schedule_entries as entry
      where entry.local_date = p_local_date
        and entry.status in ('confirmed', 'completed', 'active')
        and entry.occupied_span && pg_catalog.int4range(
          candidate.value,
          candidate.value
            + v_variant.duration_minutes::integer
            + v_variant.buffer_minutes::integer,
          '[)'
        )
    )
  order by candidate.value
  limit 96;
end;
$$;

reset role;

revoke create on schema gioia_private from gioia_mutator;
revoke gioia_mutator from postgres;

revoke all on function gioia_private.rome_today()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.resolve_active_variant(text, text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.assert_interval_open(date, smallint, smallint, smallint)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.assert_public_slot_policy(date, smallint)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.assert_owner_slot_policy(date, smallint)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.get_public_availability(date, text, text)
  from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.get_public_availability(date, text, text)
  to app_runtime;

commit;
