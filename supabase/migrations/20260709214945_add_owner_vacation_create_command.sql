begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to current_user
  with admin false, inherit false, set true;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.owner_create_vacation(
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint bytea,
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
  v_dates date[];
  v_vacation gioia_private.vacations%rowtype;
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  select command_request_id, command.replayed,
    stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_result
  from gioia_private.begin_command(
    'owner_create_vacation',
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

    select pg_catalog.array_agg(day.value::date order by day.value)
    into strict v_dates
    from pg_catalog.generate_series(
      p_start_date::timestamp,
      p_end_date::timestamp,
      interval '1 day'
    ) as day(value);

    perform gioia_private.lock_schedule_dates(v_dates);
    perform gioia_private.assert_vacation_span_clear(p_start_date, p_end_date);

    insert into gioia_private.vacations (
      start_date, end_date, status, reason, source, created_by
    ) values (
      p_start_date, p_end_date, 'active',
      pg_catalog.nullif(pg_catalog.btrim(p_reason), ''),
      'admin', p_actor_user_id
    )
    returning * into v_vacation;

    perform gioia_private.record_domain_change(
      'vacation', v_vacation.id, v_vacation.version, 'create', 'admin',
      v_command_id, p_actor_user_id,
      array[
        'start_date', 'end_date', 'status', 'reason', 'source', 'created_by'
      ]::text[]
    );

    v_status := 201;
    v_result := gioia_private.complete_command(
      v_command_id, v_status, 'vacation', v_vacation.id,
      'VACATION_CREATED'
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
revoke gioia_mutator from current_user;

revoke all on function gioia_private.owner_create_vacation(
  uuid, text, bytea, date, date, text
) from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.owner_create_vacation(
  uuid, text, bytea, date, date, text
) to app_runtime;

commit;
