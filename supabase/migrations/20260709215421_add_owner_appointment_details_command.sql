begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.owner_update_appointment_details(
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_entry_id uuid,
  p_expected_version integer,
  p_patch jsonb
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
  v_name text;
  v_email extensions.citext;
  v_phone text;
  v_client_note text;
  v_internal_note text;
  v_changed_fields text[] := array[]::text[];
  v_entry gioia_private.schedule_entries%rowtype;
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  select command_request_id, command.replayed,
    stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_result
  from gioia_private.begin_command(
    'owner_update_appointment_details',
    gioia_private.owner_scope_hash(p_actor_user_id),
    p_idempotency_key,
    p_request_fingerprint
  ) as command;

  if v_replayed then
    return query select v_status, v_result, true;
    return;
  end if;

  begin
    if p_patch is null
      or pg_catalog.jsonb_typeof(p_patch) <> 'object'
      or p_patch = '{}'::jsonb
      or p_patch - array[
        'client_name', 'client_email', 'client_phone',
        'client_note', 'internal_note'
      ] <> '{}'::jsonb
      or (p_patch ? 'client_name' and (
        pg_catalog.jsonb_typeof(p_patch -> 'client_name') <> 'string'
        or pg_catalog.length(pg_catalog.btrim(p_patch ->> 'client_name'))
          not between 1 and 160
      ))
      or (p_patch ? 'client_email'
        and pg_catalog.jsonb_typeof(p_patch -> 'client_email')
          not in ('string', 'null'))
      or (pg_catalog.jsonb_typeof(p_patch -> 'client_email') = 'string' and (
        pg_catalog.length(pg_catalog.btrim(p_patch ->> 'client_email'))
          not between 3 and 320
        or pg_catalog.strpos(p_patch ->> 'client_email', '@') < 2
      ))
      or (p_patch ? 'client_phone'
        and pg_catalog.jsonb_typeof(p_patch -> 'client_phone')
          not in ('string', 'null'))
      or (pg_catalog.jsonb_typeof(p_patch -> 'client_phone') = 'string'
        and pg_catalog.length(pg_catalog.btrim(p_patch ->> 'client_phone'))
          not between 1 and 40)
      or (p_patch ? 'client_note'
        and pg_catalog.jsonb_typeof(p_patch -> 'client_note')
          not in ('string', 'null'))
      or (pg_catalog.jsonb_typeof(p_patch -> 'client_note') = 'string'
        and pg_catalog.length(p_patch ->> 'client_note') > 2000)
      or (p_patch ? 'internal_note'
        and pg_catalog.jsonb_typeof(p_patch -> 'internal_note')
          not in ('string', 'null'))
      or (pg_catalog.jsonb_typeof(p_patch -> 'internal_note') = 'string'
        and pg_catalog.length(p_patch ->> 'internal_note') > 2000) then
      raise sqlstate 'PT400' using message = 'APPOINTMENT_DETAILS_INVALID';
    end if;

    select entry.*
    into v_entry
    from gioia_private.schedule_entries as entry
    where entry.id = p_entry_id and entry.kind = 'appointment'
    for update;
    if not found then
      raise sqlstate 'PT404' using message = 'APPOINTMENT_NOT_FOUND';
    end if;
    if v_entry.version is distinct from p_expected_version then
      raise sqlstate 'PT409' using message = 'VERSION_CONFLICT';
    end if;

    v_name := case when p_patch ? 'client_name'
      then pg_catalog.btrim(p_patch ->> 'client_name')
      else v_entry.client_name end;
    v_email := case
      when not (p_patch ? 'client_email') then v_entry.client_email
      when pg_catalog.jsonb_typeof(p_patch -> 'client_email') = 'null' then null
      else pg_catalog.lower(
        pg_catalog.btrim(p_patch ->> 'client_email')
      )::extensions.citext end;
    v_phone := case
      when not (p_patch ? 'client_phone') then v_entry.client_phone
      when pg_catalog.jsonb_typeof(p_patch -> 'client_phone') = 'null' then null
      else pg_catalog.btrim(p_patch ->> 'client_phone') end;
    v_client_note := case
      when not (p_patch ? 'client_note') then v_entry.client_note
      when pg_catalog.jsonb_typeof(p_patch -> 'client_note') = 'null' then null
      else pg_catalog.nullif(
        pg_catalog.btrim(p_patch ->> 'client_note'), ''
      ) end;
    v_internal_note := case
      when not (p_patch ? 'internal_note') then v_entry.internal_note
      when pg_catalog.jsonb_typeof(p_patch -> 'internal_note') = 'null' then null
      else pg_catalog.nullif(
        pg_catalog.btrim(p_patch ->> 'internal_note'), ''
      ) end;

    if v_entry.client_name is distinct from v_name then
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'client_name');
    end if;
    if v_entry.client_email is distinct from v_email then
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'client_email');
    end if;
    if v_entry.client_phone is distinct from v_phone then
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'client_phone');
    end if;
    if v_entry.client_note is distinct from v_client_note then
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'client_note');
    end if;
    if v_entry.internal_note is distinct from v_internal_note then
      v_changed_fields := pg_catalog.array_append(v_changed_fields, 'internal_note');
    end if;
    if pg_catalog.cardinality(v_changed_fields) = 0 then
      raise sqlstate 'PT400' using message = 'APPOINTMENT_DETAILS_NO_CHANGE';
    end if;

    update gioia_private.schedule_entries as entry
    set client_name = v_name,
        client_email = v_email,
        client_phone = v_phone,
        client_note = v_client_note,
        internal_note = v_internal_note
    where entry.id = p_entry_id
      and entry.version = p_expected_version
      and entry.kind = 'appointment'
    returning * into strict v_entry;

    perform gioia_private.record_domain_change(
      'schedule_entry', v_entry.id, v_entry.version, 'update', 'admin',
      v_command_id, p_actor_user_id, v_changed_fields
    );

    v_status := 200;
    v_result := gioia_private.complete_command(
      v_command_id, v_status, 'schedule_entry', v_entry.id,
      'APPOINTMENT_DETAILS_UPDATED'
    );
  exception
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
revoke gioia_mutator from postgres;

revoke all on function gioia_private.owner_update_appointment_details(
  uuid, text, bytea, uuid, integer, jsonb
) from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.owner_update_appointment_details(
  uuid, text, bytea, uuid, integer, jsonb
) to app_runtime;

commit;
