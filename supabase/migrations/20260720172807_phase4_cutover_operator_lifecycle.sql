begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;
set local role gioia_mutator;

create function gioia_private.begin_cutover_write_freeze(p_reason_code text)
returns table (freeze_id uuid, version integer)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_control gioia_private.cutover_write_control%rowtype;
  v_freeze_id uuid := extensions.gen_random_uuid();
begin
  if p_reason_code is null or p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'Invalid cutover reason code';
  end if;
  select * into strict v_control
  from gioia_private.cutover_write_control where singleton for update;
  if v_control.mode <> 'open' then
    raise exception 'Cutover writes are not open';
  end if;
  update gioia_private.cutover_write_control as control
  set mode = 'frozen', freeze_id = v_freeze_id,
      version = control.version + 1,
      reason_code = p_reason_code, changed_at = statement_timestamp()
  where control.singleton returning control.* into strict v_control;
  insert into gioia_private.cutover_transition_log (
    freeze_id, from_mode, to_mode, control_version, reason_code
  ) values (v_freeze_id, 'open', 'frozen', v_control.version, p_reason_code);
  return query select v_freeze_id, v_control.version;
end;
$$;

create function gioia_private.begin_cutover_canary_run(
  p_freeze_id uuid, p_label_code text, p_expires_at timestamptz
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_run_id uuid;
begin
  if p_label_code is null or p_label_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'Invalid canary label code';
  end if;
  if not exists (
    select 1 from gioia_private.cutover_write_control
    where singleton and mode = 'frozen' and freeze_id = p_freeze_id
  ) then
    raise exception 'Cutover freeze does not match';
  end if;
  insert into gioia_private.cutover_canary_runs (
    freeze_id, label_code, expires_at
  ) values (p_freeze_id, p_label_code, p_expires_at)
  returning id into strict v_run_id;
  return v_run_id;
end;
$$;

create function gioia_private.issue_cutover_canary_grant(
  p_run_id uuid,
  p_token_sha256 bytea,
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_expires_at timestamptz
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_grant_id uuid;
begin
  if not exists (
    select 1 from gioia_private.cutover_canary_runs as run
    join gioia_private.cutover_write_control as control
      on control.singleton and control.freeze_id = run.freeze_id
    where run.id = p_run_id and run.status = 'active'
      and run.expires_at > statement_timestamp() and control.mode = 'frozen'
  ) then
    raise exception 'Canary run is not active';
  end if;
  insert into gioia_private.cutover_canary_grants (
    run_id, token_sha256, operation, idempotency_key,
    request_fingerprint, expires_at
  ) values (
    p_run_id, p_token_sha256, p_operation, p_idempotency_key,
    p_request_fingerprint, p_expires_at
  ) returning id into strict v_grant_id;
  return v_grant_id;
end;
$$;

create function gioia_private.revoke_cutover_canary_grant(p_grant_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  update gioia_private.cutover_canary_grants
  set status = 'revoked', revoked_at = statement_timestamp()
  where id = p_grant_id and status = 'issued';
  if not found then
    raise exception 'Canary grant is not revocable';
  end if;
end;
$$;

create function gioia_private.reconcile_cutover_canary_run(p_run_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from gioia_private.cutover_canary_grants
    where run_id = p_run_id and status = 'issued'
  ) then
    raise exception 'Canary run has unconsumed grants';
  end if;
  if exists (
    select 1 from gioia_private.cutover_canary_grants as grant_row
    where grant_row.run_id = p_run_id and grant_row.status = 'used'
      and not exists (
        select 1 from gioia_private.command_requests as command
        where command.operation = grant_row.operation
          and command.idempotency_key = grant_row.idempotency_key
          and command.request_fingerprint = grant_row.request_fingerprint
          and command.state = 'completed'
      )
  ) then
    raise exception 'Canary commands have not completed';
  end if;
  if exists (
    select 1
    from gioia_private.cutover_canary_grants as grant_row
    join gioia_private.command_requests as command
      on command.operation = grant_row.operation
      and command.idempotency_key = grant_row.idempotency_key
      and command.request_fingerprint = grant_row.request_fingerprint
    join gioia_private.schedule_entries as entry
      on entry.id = command.resource_id and command.resource_kind = 'schedule_entry'
    where grant_row.run_id = p_run_id
      and grant_row.operation in (
        'public_booking', 'owner_create_appointment', 'owner_create_block'
      ) and entry.status <> 'cancelled'
  ) or exists (
    select 1
    from gioia_private.cutover_canary_grants as grant_row
    join gioia_private.command_requests as command
      on command.operation = grant_row.operation
      and command.idempotency_key = grant_row.idempotency_key
      and command.request_fingerprint = grant_row.request_fingerprint
    join gioia_private.vacations as vacation
      on vacation.id = command.resource_id and command.resource_kind = 'vacation'
    where grant_row.run_id = p_run_id
      and grant_row.operation = 'owner_create_vacation'
      and vacation.status <> 'cancelled'
  ) then
    raise exception 'Canary resources have not been cleaned up';
  end if;
  update gioia_private.cutover_canary_runs
  set status = 'reconciled', reconciled_at = statement_timestamp()
  where id = p_run_id and status = 'active';
  if not found then
    raise exception 'Canary run is not active';
  end if;
end;
$$;

create function gioia_private.enter_cutover_owner_reconcile(
  p_freeze_id uuid, p_expected_version integer, p_reason_code text
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare v_control gioia_private.cutover_write_control%rowtype;
begin
  if p_reason_code is null or p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'Invalid cutover reason code';
  end if;
  select * into strict v_control from gioia_private.cutover_write_control
  where singleton for update;
  if v_control.mode <> 'frozen' or v_control.freeze_id <> p_freeze_id
    or v_control.version <> p_expected_version then
    raise exception 'Cutover state changed';
  end if;
  if exists (
    select 1 from gioia_private.cutover_canary_runs
    where freeze_id = p_freeze_id and status <> 'reconciled'
  ) then
    raise exception 'Canary runs are not reconciled';
  end if;
  update gioia_private.cutover_write_control
  set mode = 'owner_reconcile', version = version + 1,
      reason_code = p_reason_code, changed_at = statement_timestamp()
  where singleton returning * into strict v_control;
  insert into gioia_private.cutover_transition_log (
    freeze_id, from_mode, to_mode, control_version, reason_code
  ) values (
    p_freeze_id, 'frozen', 'owner_reconcile', v_control.version, p_reason_code
  );
  return v_control.version;
end;
$$;

create function gioia_private.complete_cutover_unfreeze(
  p_freeze_id uuid, p_expected_version integer, p_reason_code text
)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare v_control gioia_private.cutover_write_control%rowtype;
begin
  if p_reason_code is null or p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'Invalid cutover reason code';
  end if;
  select * into strict v_control from gioia_private.cutover_write_control
  where singleton for update;
  if v_control.mode <> 'owner_reconcile' or v_control.freeze_id <> p_freeze_id
    or v_control.version <> p_expected_version then
    raise exception 'Cutover state changed';
  end if;
  if exists (
    select 1 from gioia_private.cutover_canary_runs
    where freeze_id = p_freeze_id and status <> 'reconciled'
  ) then
    raise exception 'Canary runs are not reconciled';
  end if;
  update gioia_private.cutover_write_control
  set mode = 'open', freeze_id = null, version = version + 1,
      reason_code = p_reason_code, changed_at = statement_timestamp()
  where singleton returning * into strict v_control;
  insert into gioia_private.cutover_transition_log (
    freeze_id, from_mode, to_mode, control_version, reason_code
  ) values (
    p_freeze_id, 'owner_reconcile', 'open', v_control.version, p_reason_code
  );
  return v_control.version;
end;
$$;

reset role;
revoke create on schema gioia_private from gioia_mutator;

revoke all on function gioia_private.begin_cutover_write_freeze(text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.begin_cutover_canary_run(uuid,text,timestamptz)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.issue_cutover_canary_grant(
  uuid,bytea,text,text,bytea,timestamptz
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.revoke_cutover_canary_grant(uuid)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.reconcile_cutover_canary_run(uuid)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.enter_cutover_owner_reconcile(uuid,integer,text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.complete_cutover_unfreeze(uuid,integer,text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;

revoke gioia_mutator from postgres;
commit;
