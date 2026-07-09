begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.create_public_booking(
  p_principal_scope_hash bytea,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_local_date date,
  p_start_minutes smallint,
  p_service_id text,
  p_variant_id text,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_client_note text
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
  v_variant record;
  v_entry gioia_private.schedule_entries%rowtype;
begin
  select command_request_id, command.replayed,
    stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_result
  from gioia_private.begin_command(
    'public_booking',
    p_principal_scope_hash,
    p_idempotency_key,
    p_request_fingerprint
  ) as command;

  if v_replayed then
    return query select v_status, v_result, true;
    return;
  end if;

  begin
    if p_client_name is null
      or pg_catalog.length(pg_catalog.btrim(p_client_name)) not between 1 and 160
      or p_client_email is null
      or pg_catalog.length(pg_catalog.btrim(p_client_email)) not between 3 and 320
      or pg_catalog.strpos(p_client_email, '@') < 2
      or p_client_phone is null
      or pg_catalog.length(pg_catalog.btrim(p_client_phone)) not between 1 and 40
      or (p_client_note is not null and pg_catalog.length(p_client_note) > 2000) then
      raise sqlstate 'PT400' using message = 'PUBLIC_CONTACT_INVALID';
    end if;

    perform gioia_private.assert_public_slot_policy(p_local_date, p_start_minutes);
    select * into strict v_variant
    from gioia_private.resolve_active_variant(p_service_id, p_variant_id);
    perform gioia_private.assert_interval_open(
      p_local_date,
      p_start_minutes,
      v_variant.duration_minutes,
      v_variant.buffer_minutes
    );

    perform gioia_private.lock_schedule_dates(array[p_local_date]);
    perform gioia_private.assert_schedule_date_open(p_local_date);

    insert into gioia_private.schedule_entries (
      kind,
      status,
      source,
      local_date,
      start_minutes,
      service_duration_minutes,
      buffer_minutes,
      service_id,
      variant_id,
      service_name_snapshot,
      variant_name_snapshot,
      price_cents_snapshot,
      currency_snapshot,
      client_name,
      client_email,
      client_phone,
      client_note
    ) values (
      'appointment',
      'confirmed',
      'public',
      p_local_date,
      p_start_minutes,
      v_variant.duration_minutes,
      v_variant.buffer_minutes,
      p_service_id,
      p_variant_id,
      v_variant.service_name,
      v_variant.variant_name,
      v_variant.price_cents,
      v_variant.currency,
      pg_catalog.btrim(p_client_name),
      pg_catalog.lower(pg_catalog.btrim(p_client_email))::extensions.citext,
      pg_catalog.btrim(p_client_phone),
      pg_catalog.nullif(pg_catalog.btrim(p_client_note), '')
    )
    returning * into v_entry;

    perform gioia_private.record_domain_change(
      'schedule_entry',
      v_entry.id,
      v_entry.version,
      'create',
      'public',
      v_command_id,
      null,
      array[
        'kind', 'status', 'source', 'local_date', 'start_minutes',
        'service_duration_minutes', 'buffer_minutes', 'service_id',
        'variant_id', 'client_name', 'client_email', 'client_phone',
        'client_note'
      ]::text[]
    );
    perform gioia_private.enqueue_schedule_emails(v_entry, 'booking');

    v_status := 201;
    v_result := gioia_private.complete_command(
      v_command_id,
      v_status,
      'schedule_entry',
      v_entry.id,
      'BOOKING_CREATED'
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
revoke gioia_mutator from postgres;

revoke all on function gioia_private.create_public_booking(
  bytea, text, bytea, date, smallint, text, text, text, text, text, text
) from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.create_public_booking(
  bytea, text, bytea, date, smallint, text, text, text, text, text, text
) to app_runtime;

commit;
