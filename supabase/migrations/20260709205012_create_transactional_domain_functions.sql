begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.assert_enabled_owner(p_user_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (
    select 1
    from gioia_private.owner_accounts as owner
    where owner.user_id = p_user_id
      and owner.role = 'owner'
      and owner.enabled
  ) then
    raise sqlstate 'PT403' using message = 'OWNER_AUTHORIZATION_REQUIRED';
  end if;
end;
$$;

create function gioia_private.lock_schedule_dates(p_dates date[])
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_distinct_count integer;
begin
  if p_dates is null or cardinality(p_dates) = 0 then
    raise sqlstate 'PT400' using message = 'SCHEDULE_DATE_REQUIRED';
  end if;
  if array_position(p_dates, null) is not null then
    raise sqlstate 'PT400' using message = 'SCHEDULE_DATE_INVALID';
  end if;

  select count(distinct requested.local_date)
  into v_distinct_count
  from unnest(p_dates) as requested(local_date);

  if v_distinct_count > 366 then
    raise sqlstate 'PT400' using message = 'SCHEDULE_DATE_LIMIT_EXCEEDED';
  end if;

  insert into gioia_private.schedule_day_locks (local_date)
  select distinct requested.local_date
  from unnest(p_dates) as requested(local_date)
  order by requested.local_date
  on conflict (local_date) do nothing;

  perform lock.local_date
  from gioia_private.schedule_day_locks as lock
  where lock.local_date = any (p_dates)
  order by lock.local_date
  for update;
end;
$$;

create function gioia_private.assert_schedule_date_open(p_date date)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_date is null then
    raise sqlstate 'PT400' using message = 'SCHEDULE_DATE_REQUIRED';
  end if;

  if exists (
    select 1
    from gioia_private.vacations as vacation
    where vacation.status = 'active'
      and vacation.date_span @> p_date
  ) then
    raise sqlstate 'PT409' using message = 'DATE_CLOSED_FOR_VACATION';
  end if;
end;
$$;

create function gioia_private.assert_vacation_span_clear(
  p_start_date date,
  p_end_date date
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise sqlstate 'PT400' using message = 'VACATION_DATE_RANGE_INVALID';
  end if;
  if p_end_date - p_start_date > 365 then
    raise sqlstate 'PT400' using message = 'VACATION_DATE_LIMIT_EXCEEDED';
  end if;

  if exists (
    select 1
    from gioia_private.schedule_entries as entry
    where entry.local_date between p_start_date and p_end_date
      and entry.status in ('confirmed', 'completed', 'active')
  ) then
    raise sqlstate 'PT409' using message = 'VACATION_CONFLICTS_WITH_SCHEDULE';
  end if;
end;
$$;

comment on function gioia_private.lock_schedule_dates(date[]) is
  'Internal helper. Call before every occupancy or vacation recheck and mutation.';
comment on function gioia_private.assert_schedule_date_open(date) is
  'Internal helper. The caller must hold the matching schedule day lock.';
comment on function gioia_private.assert_vacation_span_clear(date, date) is
  'Internal helper. The caller must hold every inclusive schedule day lock.';

reset role;

revoke create on schema gioia_private from gioia_mutator;

revoke all on function gioia_private.assert_enabled_owner(uuid)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.lock_schedule_dates(date[])
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.assert_schedule_date_open(date)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.assert_vacation_span_clear(date, date)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;

revoke gioia_mutator from postgres;

commit;
