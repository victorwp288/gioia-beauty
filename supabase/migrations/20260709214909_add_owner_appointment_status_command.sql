begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.owner_set_appointment_status(
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_entry_id uuid,
  p_expected_version integer,
  p_status text
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
  v_local_date date;
  v_entry gioia_private.schedule_entries%rowtype;
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  select command_request_id, command.replayed,
    stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_result
  from gioia_private.begin_command(
    'owner_set_appointment_status',
    gioia_private.owner_scope_hash(p_actor_user_id),
    p_idempotency_key,
    p_request_fingerprint
  ) as command;

  if v_replayed then
    return query select v_status, v_result, true;
    return;
  end if;

  begin
    if p_status not in ('completed', 'no_show') then
      raise sqlstate 'PT400' using message = 'STATUS_TRANSITION_INVALID';
    end if;

    select entry.local_date
    into v_local_date
    from gioia_private.schedule_entries as entry
    where entry.id = p_entry_id and entry.kind = 'appointment';
    if not found then
      raise sqlstate 'PT404' using message = 'APPOINTMENT_NOT_FOUND';
    end if;

    perform gioia_private.lock_schedule_dates(array[v_local_date]);
    select entry.*
    into strict v_entry
    from gioia_private.schedule_entries as entry
    where entry.id = p_entry_id and entry.kind = 'appointment'
    for update;

    if v_entry.version is distinct from p_expected_version then
      raise sqlstate 'PT409' using message = 'VERSION_CONFLICT';
    end if;
    if v_entry.status <> 'confirmed' then
      raise sqlstate 'PT409' using message = 'STATUS_TRANSITION_INVALID';
    end if;

    update gioia_private.schedule_entries as entry
    set status = p_status
    where entry.id = p_entry_id
      and entry.version = p_expected_version
      and entry.status = 'confirmed'
    returning * into strict v_entry;

    perform gioia_private.record_domain_change(
      'schedule_entry', v_entry.id, v_entry.version, 'update', 'admin',
      v_command_id, p_actor_user_id, array['status']::text[]
    );

    v_status := 200;
    v_result := gioia_private.complete_command(
      v_command_id, v_status, 'schedule_entry', v_entry.id,
      'APPOINTMENT_STATUS_UPDATED'
    );
  exception
    when exclusion_violation then
      v_status := 409;
      v_result := gioia_private.fail_command(
        v_command_id, v_status, 'SLOT_UNAVAILABLE'
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
          then v_error_code else 'APPOINTMENT_NOT_FOUND' end
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

revoke all on function gioia_private.owner_set_appointment_status(
  uuid, text, bytea, uuid, integer, text
) from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.owner_set_appointment_status(
  uuid, text, bytea, uuid, integer, text
) to app_runtime;

revoke gioia_mutator from postgres;

commit;
