begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.owner_cancel_vacation(
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_vacation_id uuid,
  p_expected_version integer
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
  v_start_date date;
  v_end_date date;
  v_dates date[];
  v_vacation gioia_private.vacations%rowtype;
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  select command_request_id, command.replayed,
    stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_result
  from gioia_private.begin_command(
    'owner_cancel_vacation',
    gioia_private.owner_scope_hash(p_actor_user_id),
    p_idempotency_key,
    p_request_fingerprint
  ) as command;

  if v_replayed then
    return query select v_status, v_result, true;
    return;
  end if;

  begin
    select vacation.start_date, vacation.end_date
    into v_start_date, v_end_date
    from gioia_private.vacations as vacation
    where vacation.id = p_vacation_id;
    if not found then
      raise sqlstate 'PT404' using message = 'VACATION_NOT_FOUND';
    end if;

    select pg_catalog.array_agg(day.value::date order by day.value)
    into strict v_dates
    from pg_catalog.generate_series(
      v_start_date::timestamp,
      v_end_date::timestamp,
      interval '1 day'
    ) as day(value);
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
      raise sqlstate 'PT409' using message = 'VACATION_NOT_CANCELLABLE';
    end if;

    update gioia_private.vacations as vacation
    set status = 'cancelled',
        cancelled_at = pg_catalog.statement_timestamp(),
        cancelled_by = p_actor_user_id
    where vacation.id = p_vacation_id
      and vacation.version = p_expected_version
      and vacation.status = 'active'
    returning * into strict v_vacation;

    perform gioia_private.record_domain_change(
      'vacation', v_vacation.id, v_vacation.version, 'cancel', 'admin',
      v_command_id, p_actor_user_id,
      array['status', 'cancelled_at', 'cancelled_by']::text[]
    );

    v_status := 200;
    v_result := gioia_private.complete_command(
      v_command_id, v_status, 'vacation', v_vacation.id,
      'VACATION_CANCELLED'
    );
  exception
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

revoke all on function gioia_private.owner_cancel_vacation(
  uuid, text, bytea, uuid, integer
) from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.owner_cancel_vacation(
  uuid, text, bytea, uuid, integer
) to app_runtime;

revoke gioia_mutator from postgres;

commit;
