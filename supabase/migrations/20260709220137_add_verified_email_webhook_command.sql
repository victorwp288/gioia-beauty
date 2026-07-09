begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to current_user
  with admin false, inherit false, set true;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.process_verified_email_webhook(
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_kind text,
  p_payload_sha256 bytea,
  p_received_at timestamptz
)
returns table (
  processing_state text,
  replayed boolean,
  error_code text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted boolean := false;
  v_event gioia_private.email_webhook_events%rowtype;
  v_outbox gioia_private.email_outbox%rowtype;
  v_subscriber gioia_private.newsletter_subscribers%rowtype;
  v_target_status text;
begin
  if p_provider_event_id is null
    or pg_catalog.length(p_provider_event_id) not between 1 and 255
    or p_event_kind is null
    or p_event_kind not in ('delivered', 'bounced', 'complained', 'other')
    or p_payload_sha256 is null
    or pg_catalog.octet_length(p_payload_sha256) <> 32
    or p_received_at is null
    or (p_provider_message_id is not null
      and pg_catalog.length(p_provider_message_id) not between 1 and 255) then
    raise sqlstate 'PT400' using message = 'VERIFIED_WEBHOOK_INVALID';
  end if;

  insert into gioia_private.email_webhook_events (
    provider_event_id, provider_message_id, event_kind,
    payload_sha256, signature_verified, received_at
  ) values (
    p_provider_event_id, p_provider_message_id, p_event_kind,
    p_payload_sha256, true, p_received_at
  )
  on conflict (provider_event_id) do nothing
  returning true into v_inserted;
  v_inserted := pg_catalog.coalesce(v_inserted, false);

  select webhook.* into strict v_event
  from gioia_private.email_webhook_events as webhook
  where webhook.provider_event_id = p_provider_event_id
  for update;

  if v_event.provider_message_id is distinct from p_provider_message_id
    or v_event.event_kind is distinct from p_event_kind
    or v_event.payload_sha256 is distinct from p_payload_sha256 then
    raise sqlstate 'PT409' using message = 'WEBHOOK_EVENT_ID_REUSED';
  end if;

  if v_event.processed_at is not null then
    return query select 'processed'::text, true, null::text;
    return;
  end if;

  if p_event_kind = 'other' then
    update gioia_private.email_webhook_events as webhook
    set processed_at = pg_catalog.statement_timestamp(),
        processing_error_code = null
    where webhook.provider_event_id = p_provider_event_id;
    return query select 'processed'::text, not v_inserted, null::text;
    return;
  end if;

  if p_provider_message_id is null then
    update gioia_private.email_webhook_events as webhook
    set processing_error_code = 'MESSAGE_ID_REQUIRED'
    where webhook.provider_event_id = p_provider_event_id;
    return query select 'error'::text, not v_inserted, 'MESSAGE_ID_REQUIRED'::text;
    return;
  end if;

  select outbox.* into v_outbox
  from gioia_private.email_outbox as outbox
  where outbox.provider_message_id = p_provider_message_id
  for update;

  if not found then
    update gioia_private.email_webhook_events as webhook
    set processing_error_code = 'PROVIDER_MESSAGE_NOT_FOUND'
    where webhook.provider_event_id = p_provider_event_id;
    return query
      select 'error'::text, not v_inserted, 'PROVIDER_MESSAGE_NOT_FOUND'::text;
    return;
  end if;

  v_target_status := case p_event_kind
    when 'bounced' then 'bounced'
    when 'complained' then 'complained'
    else null
  end;

  if v_target_status = 'bounced' and v_outbox.status = 'sent' then
    update gioia_private.email_outbox as outbox
    set status = 'bounced', last_error_code = 'EMAIL_BOUNCED'
    where outbox.id = v_outbox.id
    returning outbox.* into strict v_outbox;
  elsif v_target_status = 'complained'
    and v_outbox.status in ('sent', 'bounced') then
    update gioia_private.email_outbox as outbox
    set status = 'complained', last_error_code = 'EMAIL_COMPLAINED'
    where outbox.id = v_outbox.id
    returning outbox.* into strict v_outbox;
  end if;

  if v_target_status is not null and v_outbox.aggregate_kind = 'subscriber' then
    update gioia_private.newsletter_subscribers as subscriber
    set status = v_target_status
    where subscriber.id = v_outbox.aggregate_id
      and (
        (v_target_status = 'bounced'
          and (
            (subscriber.status = 'pending'
              and subscriber.version = v_outbox.aggregate_version)
            or (subscriber.status = 'active'
              and subscriber.version = v_outbox.aggregate_version + 1)
          ))
        or (v_target_status = 'complained'
          and (
            (subscriber.status = 'pending'
              and subscriber.version = v_outbox.aggregate_version)
            or (subscriber.status = 'active'
              and subscriber.version = v_outbox.aggregate_version + 1)
            or (subscriber.status = 'bounced'
              and subscriber.version in (
                v_outbox.aggregate_version + 1,
                v_outbox.aggregate_version + 2
              ))
          ))
      )
    returning subscriber.* into v_subscriber;

    if found then
      perform gioia_private.record_domain_change(
        'subscriber', v_subscriber.id, v_subscriber.version, 'update',
        'system', null, null, array['status']
      );
    end if;
  end if;

  update gioia_private.email_webhook_events as webhook
  set processed_at = pg_catalog.statement_timestamp(),
      processing_error_code = null
  where webhook.provider_event_id = p_provider_event_id;

  return query select 'processed'::text, not v_inserted, null::text;
end;
$$;

comment on function gioia_private.process_verified_email_webhook(
  text, text, text, bytea, timestamptz
) is 'Accepts fields only after server signature verification and stores no payload.';

reset role;

revoke create on schema gioia_private from gioia_mutator;
revoke gioia_mutator from current_user;

revoke all on function gioia_private.process_verified_email_webhook(
  text, text, text, bytea, timestamptz
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.process_verified_email_webhook(
  text, text, text, bytea, timestamptz
) to app_runtime;

commit;
