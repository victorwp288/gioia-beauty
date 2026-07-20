begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index schedule_entries_owner_page_idx
  on gioia_private.schedule_entries (local_date, start_minutes, id);

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.list_schedule_as_owner(
  p_actor_user_id uuid,
  p_from_date date,
  p_to_date date,
  p_kind text,
  p_statuses text[],
  p_after_date date,
  p_after_start_minutes smallint,
  p_after_id uuid,
  p_limit smallint
)
returns table (item jsonb)
language plpgsql
stable
security definer
set search_path = ''
rows 101
as $$
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  if p_from_date is null or p_to_date is null
    or p_to_date - p_from_date not between 0 and 31 then
    raise sqlstate 'PT400' using message = 'SCHEDULE_RANGE_INVALID';
  end if;
  if p_kind is not null and p_kind not in ('appointment', 'block') then
    raise sqlstate 'PT400' using message = 'SCHEDULE_KIND_INVALID';
  end if;
  if p_statuses is null or pg_catalog.cardinality(p_statuses) > 5
    or pg_catalog.array_position(p_statuses, null::text) is not null
    or exists (
      select 1 from pg_catalog.unnest(p_statuses) as status(value)
      where status.value not in (
        'confirmed', 'completed', 'cancelled', 'no_show', 'active'
      )
    )
    or pg_catalog.cardinality(p_statuses) <> (
      select pg_catalog.count(distinct status.value)::integer
      from pg_catalog.unnest(p_statuses) as status(value)
    ) then
    raise sqlstate 'PT400' using message = 'SCHEDULE_STATUSES_INVALID';
  end if;
  if (p_after_date is null or p_after_start_minutes is null or p_after_id is null)
    and not (p_after_date is null and p_after_start_minutes is null and p_after_id is null) then
    raise sqlstate 'PT400' using message = 'SCHEDULE_CURSOR_INVALID';
  end if;
  if p_after_start_minutes is not null and p_after_start_minutes not between 0 and 1439 then
    raise sqlstate 'PT400' using message = 'SCHEDULE_CURSOR_INVALID';
  end if;
  if p_limit is null or p_limit not between 1 and 101 then
    raise sqlstate 'PT400' using message = 'SCHEDULE_LIMIT_INVALID';
  end if;

  return query
  select case when entry.kind = 'appointment' then
    pg_catalog.jsonb_build_object(
      'id', entry.id::text,
      'schemaVersion', entry.schema_version,
      'kind', entry.kind,
      'status', entry.status,
      'source', entry.source,
      'date', entry.local_date::text,
      'startMinutes', entry.start_minutes,
      'serviceDurationMinutes', entry.service_duration_minutes,
      'bufferMinutes', entry.buffer_minutes,
      'serviceId', entry.service_id,
      'variantId', entry.variant_id,
      'serviceNameSnapshot', entry.service_name_snapshot,
      'variantNameSnapshot', entry.variant_name_snapshot,
      'priceCentsSnapshot', entry.price_cents_snapshot,
      'currencySnapshot', entry.currency_snapshot,
      'clientName', entry.client_name,
      'clientEmail', entry.client_email::text,
      'clientPhone', entry.client_phone,
      'clientNote', entry.client_note,
      'internalNote', entry.internal_note,
      'cancelledAt', case when entry.cancelled_at is null then null else
        pg_catalog.to_char(entry.cancelled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'cancelledBy', entry.cancelled_by,
      'cancellationReason', entry.cancellation_reason,
      'version', entry.version,
      'createdAt', pg_catalog.to_char(entry.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(entry.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  else
    pg_catalog.jsonb_build_object(
      'id', entry.id::text,
      'schemaVersion', entry.schema_version,
      'kind', entry.kind,
      'status', entry.status,
      'source', entry.source,
      'date', entry.local_date::text,
      'startMinutes', entry.start_minutes,
      'serviceDurationMinutes', entry.service_duration_minutes,
      'bufferMinutes', entry.buffer_minutes,
      'internalNote', entry.internal_note,
      'cancelledAt', case when entry.cancelled_at is null then null else
        pg_catalog.to_char(entry.cancelled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'cancelledBy', entry.cancelled_by,
      'cancellationReason', entry.cancellation_reason,
      'version', entry.version,
      'createdAt', pg_catalog.to_char(entry.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(entry.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) end
  from gioia_private.schedule_entries as entry
  where entry.local_date between p_from_date and p_to_date
    and (p_kind is null or entry.kind = p_kind)
    and (pg_catalog.cardinality(p_statuses) = 0 or entry.status = any(p_statuses))
    and (p_after_date is null or
      (entry.local_date, entry.start_minutes, entry.id)
        > (p_after_date, p_after_start_minutes, p_after_id))
  order by entry.local_date, entry.start_minutes, entry.id
  limit p_limit;
end;
$$;

create function gioia_private.count_schedule_as_owner(
  p_actor_user_id uuid,
  p_from_date date,
  p_to_date date,
  p_kind text,
  p_statuses text[]
)
returns table (kind text, status text, count integer)
language plpgsql
stable
security definer
set search_path = ''
rows 6
as $$
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  if p_from_date is null or p_to_date is null
    or p_to_date - p_from_date not between 0 and 31 then
    raise sqlstate 'PT400' using message = 'SCHEDULE_RANGE_INVALID';
  end if;
  if p_kind is not null and p_kind not in ('appointment', 'block') then
    raise sqlstate 'PT400' using message = 'SCHEDULE_KIND_INVALID';
  end if;
  if p_statuses is null or pg_catalog.cardinality(p_statuses) > 5
    or pg_catalog.array_position(p_statuses, null::text) is not null
    or exists (
      select 1 from pg_catalog.unnest(p_statuses) as candidate(value)
      where candidate.value not in (
        'confirmed', 'completed', 'cancelled', 'no_show', 'active'
      )
    )
    or pg_catalog.cardinality(p_statuses) <> (
      select pg_catalog.count(distinct candidate.value)::integer
      from pg_catalog.unnest(p_statuses) as candidate(value)
    ) then
    raise sqlstate 'PT400' using message = 'SCHEDULE_STATUSES_INVALID';
  end if;

  return query
  select entry.kind, entry.status, pg_catalog.count(*)::integer
  from gioia_private.schedule_entries as entry
  where entry.local_date between p_from_date and p_to_date
    and (p_kind is null or entry.kind = p_kind)
    and (pg_catalog.cardinality(p_statuses) = 0 or entry.status = any(p_statuses))
  group by entry.kind, entry.status
  order by entry.kind, entry.status;
end;
$$;

create function gioia_private.export_schedule_as_owner(
  p_actor_user_id uuid,
  p_from_date date,
  p_to_date date,
  p_include_notes boolean,
  p_after_date date,
  p_after_start_minutes smallint,
  p_after_id uuid,
  p_limit smallint
)
returns table (item jsonb)
language plpgsql
stable
security definer
set search_path = ''
rows 501
as $$
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  if p_from_date is null or p_to_date is null or p_include_notes is null
    or p_to_date - p_from_date not between 0 and 365 then
    raise sqlstate 'PT400' using message = 'SCHEDULE_EXPORT_RANGE_INVALID';
  end if;
  if (p_after_date is null or p_after_start_minutes is null or p_after_id is null)
    and not (p_after_date is null and p_after_start_minutes is null and p_after_id is null) then
    raise sqlstate 'PT400' using message = 'SCHEDULE_EXPORT_CURSOR_INVALID';
  end if;
  if p_after_start_minutes is not null and p_after_start_minutes not between 0 and 1439 then
    raise sqlstate 'PT400' using message = 'SCHEDULE_EXPORT_CURSOR_INVALID';
  end if;
  if p_limit is null or p_limit not between 1 and 501 then
    raise sqlstate 'PT400' using message = 'SCHEDULE_EXPORT_LIMIT_INVALID';
  end if;

  return query
  select case when entry.kind = 'appointment' then
    pg_catalog.jsonb_build_object(
      'id', entry.id::text, 'schemaVersion', entry.schema_version,
      'kind', entry.kind, 'status', entry.status, 'source', entry.source,
      'date', entry.local_date::text, 'startMinutes', entry.start_minutes,
      'serviceDurationMinutes', entry.service_duration_minutes,
      'bufferMinutes', entry.buffer_minutes, 'serviceId', entry.service_id,
      'variantId', entry.variant_id, 'serviceNameSnapshot', entry.service_name_snapshot,
      'variantNameSnapshot', entry.variant_name_snapshot,
      'priceCentsSnapshot', entry.price_cents_snapshot,
      'currencySnapshot', entry.currency_snapshot,
      'clientName', entry.client_name, 'clientEmail', entry.client_email::text,
      'clientPhone', entry.client_phone,
      'clientNote', case when p_include_notes then entry.client_note else null end,
      'internalNote', case when p_include_notes then entry.internal_note else null end,
      'cancelledAt', case when entry.cancelled_at is null then null else
        pg_catalog.to_char(entry.cancelled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'cancelledBy', entry.cancelled_by,
      'cancellationReason', case when p_include_notes then entry.cancellation_reason else null end,
      'version', entry.version,
      'createdAt', pg_catalog.to_char(entry.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(entry.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  else
    pg_catalog.jsonb_build_object(
      'id', entry.id::text, 'schemaVersion', entry.schema_version,
      'kind', entry.kind, 'status', entry.status, 'source', entry.source,
      'date', entry.local_date::text, 'startMinutes', entry.start_minutes,
      'serviceDurationMinutes', entry.service_duration_minutes,
      'bufferMinutes', entry.buffer_minutes,
      'internalNote', case when p_include_notes then entry.internal_note else null end,
      'cancelledAt', case when entry.cancelled_at is null then null else
        pg_catalog.to_char(entry.cancelled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'cancelledBy', entry.cancelled_by,
      'cancellationReason', case when p_include_notes then entry.cancellation_reason else null end,
      'version', entry.version,
      'createdAt', pg_catalog.to_char(entry.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(entry.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) end
  from gioia_private.schedule_entries as entry
  where entry.local_date between p_from_date and p_to_date
    and (p_after_date is null or
      (entry.local_date, entry.start_minutes, entry.id)
        > (p_after_date, p_after_start_minutes, p_after_id))
  order by entry.local_date, entry.start_minutes, entry.id
  limit p_limit;
end;
$$;

reset role;

revoke create on schema gioia_private from gioia_mutator;

revoke all on function gioia_private.list_schedule_as_owner(
  uuid,date,date,text,text[],date,smallint,uuid,smallint
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.count_schedule_as_owner(
  uuid,date,date,text,text[]
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.export_schedule_as_owner(
  uuid,date,date,boolean,date,smallint,uuid,smallint
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.list_schedule_as_owner(
  uuid,date,date,text,text[],date,smallint,uuid,smallint
) to app_runtime;
grant execute on function gioia_private.count_schedule_as_owner(
  uuid,date,date,text,text[]
) to app_runtime;
grant execute on function gioia_private.export_schedule_as_owner(
  uuid,date,date,boolean,date,smallint,uuid,smallint
) to app_runtime;

revoke gioia_mutator from postgres;

commit;
