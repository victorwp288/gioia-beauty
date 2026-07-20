begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.owner_update_vacation(
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_vacation_id uuid,
  p_expected_version integer,
  p_start_date date,
  p_end_date date,
  p_reason text
)
returns table (http_status smallint, result jsonb, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_command_id uuid;
  v_replayed boolean;
  v_status smallint;
  v_result jsonb;
  v_error_code text;
  v_existing_start date;
  v_existing_end date;
  v_dates date[];
  v_vacation gioia_private.vacations%rowtype;
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  select command_request_id, command.replayed,
    stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_result
  from gioia_private.begin_command(
    'owner_update_vacation',
    gioia_private.owner_scope_hash(p_actor_user_id),
    p_idempotency_key,
    p_request_fingerprint
  ) as command;

  if v_replayed then
    return query select v_status, v_result, true;
    return;
  end if;

  begin
    if p_reason is not null and pg_catalog.length(p_reason) > 1000 then
      raise sqlstate 'PT400' using message = 'VACATION_REASON_INVALID';
    end if;
    if p_start_date is null or p_end_date is null
      or p_start_date > p_end_date
      or p_end_date - p_start_date > 365 then
      raise sqlstate 'PT400' using message = 'VACATION_DATE_RANGE_INVALID';
    end if;
    if p_start_date < gioia_private.rome_today() then
      raise sqlstate 'PT400' using message = 'VACATION_DATE_IN_PAST';
    end if;

    select vacation.start_date, vacation.end_date
    into v_existing_start, v_existing_end
    from gioia_private.vacations as vacation
    where vacation.id = p_vacation_id;
    if not found then
      raise sqlstate 'PT404' using message = 'VACATION_NOT_FOUND';
    end if;

    select pg_catalog.array_agg(distinct day.value::date order by day.value::date)
    into strict v_dates
    from (
      select pg_catalog.generate_series(
        v_existing_start::timestamp,
        v_existing_end::timestamp,
        interval '1 day'
      ) as value
      union all
      select pg_catalog.generate_series(
        p_start_date::timestamp,
        p_end_date::timestamp,
        interval '1 day'
      ) as value
    ) as day;
    perform gioia_private.lock_schedule_dates(v_dates);

    select vacation.*
    into strict v_vacation
    from gioia_private.vacations as vacation
    where vacation.id = p_vacation_id
    for update;

    if v_vacation.version is distinct from p_expected_version then
      raise sqlstate 'PT409' using message = 'VERSION_CONFLICT';
    end if;
    if v_vacation.status <> 'active' then
      raise sqlstate 'PT409' using message = 'VACATION_NOT_EDITABLE';
    end if;
    if row(v_vacation.start_date, v_vacation.end_date, v_vacation.reason)
      is not distinct from row(
        p_start_date,
        p_end_date,
        nullif(pg_catalog.btrim(p_reason), '')
      ) then
      raise sqlstate 'PT409' using message = 'VACATION_NO_CHANGE';
    end if;

    perform gioia_private.assert_vacation_span_clear(p_start_date, p_end_date);

    update gioia_private.vacations as vacation
    set start_date = p_start_date,
        end_date = p_end_date,
        reason = nullif(pg_catalog.btrim(p_reason), '')
    where vacation.id = p_vacation_id
      and vacation.version = p_expected_version
      and vacation.status = 'active'
    returning * into strict v_vacation;

    perform gioia_private.record_domain_change(
      'vacation', v_vacation.id, v_vacation.version, 'update', 'admin',
      v_command_id, p_actor_user_id,
      array['start_date', 'end_date', 'reason']::text[]
    );

    v_status := 200;
    v_result := gioia_private.complete_command(
      v_command_id, v_status, 'vacation', v_vacation.id,
      'VACATION_UPDATED'
    );
  exception
    when exclusion_violation then
      v_status := 409;
      v_result := gioia_private.fail_command(
        v_command_id, v_status, 'VACATION_OVERLAP'
      );
    when sqlstate 'PT400' then
      get stacked diagnostics v_error_code = message_text;
      v_status := 400;
      v_result := gioia_private.fail_command(v_command_id, v_status, v_error_code);
    when sqlstate 'PT404' or no_data_found then
      get stacked diagnostics v_error_code = message_text;
      v_status := 404;
      v_result := gioia_private.fail_command(
        v_command_id, v_status,
        case when v_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
          then v_error_code else 'VACATION_NOT_FOUND' end
      );
    when sqlstate 'PT409' then
      get stacked diagnostics v_error_code = message_text;
      v_status := 409;
      v_result := gioia_private.fail_command(v_command_id, v_status, v_error_code);
  end;

  return query select v_status, v_result, false;
end;
$$;

reset role;

revoke create on schema gioia_private from gioia_mutator;

revoke all on function gioia_private.owner_update_vacation(
  uuid, text, bytea, uuid, integer, date, date, text
) from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.owner_update_vacation(
  uuid, text, bytea, uuid, integer, date, date, text
) to app_runtime;

revoke gioia_mutator from postgres;

commit;
