begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant usage, select on sequence
  gioia_private.domain_change_log_sequence_id_seq
to gioia_mutator;

grant gioia_mutator to current_user
  with admin false, inherit false, set true;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.owner_create_block(
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_local_date date,
  p_start_minutes smallint,
  p_duration_minutes smallint,
  p_buffer_minutes smallint,
  p_internal_note text
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
  v_entry gioia_private.schedule_entries%rowtype;
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  select command_request_id, command.replayed,
    stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_result
  from gioia_private.begin_command(
    'owner_create_block',
    gioia_private.owner_scope_hash(p_actor_user_id),
    p_idempotency_key,
    p_request_fingerprint
  ) as command;

  if v_replayed then
    return query select v_status, v_result, true;
    return;
  end if;

  begin
    if p_internal_note is not null
      and pg_catalog.length(p_internal_note) > 2000 then
      raise sqlstate 'PT400' using message = 'BLOCK_NOTE_INVALID';
    end if;

    perform gioia_private.assert_owner_slot_policy(p_local_date, p_start_minutes);
    perform gioia_private.assert_interval_open(
      p_local_date,
      p_start_minutes,
      p_duration_minutes,
      p_buffer_minutes
    );
    perform gioia_private.lock_schedule_dates(array[p_local_date]);
    perform gioia_private.assert_schedule_date_open(p_local_date);

    insert into gioia_private.schedule_entries (
      kind, status, source, local_date, start_minutes,
      service_duration_minutes, buffer_minutes, internal_note, created_by
    ) values (
      'block', 'active', 'admin', p_local_date, p_start_minutes,
      p_duration_minutes, p_buffer_minutes,
      pg_catalog.nullif(pg_catalog.btrim(p_internal_note), ''),
      p_actor_user_id
    )
    returning * into v_entry;

    perform gioia_private.record_domain_change(
      'schedule_entry', v_entry.id, v_entry.version, 'block', 'admin',
      v_command_id, p_actor_user_id,
      array[
        'kind', 'status', 'source', 'local_date', 'start_minutes',
        'service_duration_minutes', 'buffer_minutes', 'internal_note',
        'created_by'
      ]::text[]
    );

    v_status := 201;
    v_result := gioia_private.complete_command(
      v_command_id, v_status, 'schedule_entry', v_entry.id,
      'BLOCK_CREATED'
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
    when sqlstate 'PT404' then
      get stacked diagnostics v_error_code = message_text;
      v_status := 404;
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

revoke all on function gioia_private.owner_create_block(
  uuid, text, bytea, date, smallint, smallint, smallint, text
) from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.owner_create_block(
  uuid, text, bytea, date, smallint, smallint, smallint, text
) to app_runtime;

commit;
