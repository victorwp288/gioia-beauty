begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table gioia_private.email_webhook_events
  add column replay_attempt_count smallint not null default 0,
  add column replay_last_attempt_at timestamptz,
  add column replay_next_attempt_at timestamptz,
  add column replay_terminal_at timestamptz,
  add column replay_terminal_code text;

update gioia_private.email_webhook_events as webhook
set replay_next_attempt_at = pg_catalog.statement_timestamp()
where webhook.processed_at is null
  and webhook.processing_error_code = 'PROVIDER_MESSAGE_NOT_FOUND';

alter table gioia_private.email_webhook_events
  add constraint email_webhook_events_replay_attempt_bound
    check (replay_attempt_count between 0 and 5),
  add constraint email_webhook_events_replay_attempt_time_consistent check (
    (replay_attempt_count = 0 and replay_last_attempt_at is null)
    or (replay_attempt_count > 0 and replay_last_attempt_at is not null)
  ),
  add constraint email_webhook_events_replay_terminal_pair check (
    (replay_terminal_at is null and replay_terminal_code is null)
    or (replay_terminal_at is not null
      and replay_terminal_code = 'WEBHOOK_REPLAY_EXHAUSTED')
  ),
  add constraint email_webhook_events_replay_state_consistent check (
    (processed_at is not null
      and replay_next_attempt_at is null
      and replay_terminal_at is null)
    or (processed_at is null
      and processing_error_code = 'PROVIDER_MESSAGE_NOT_FOUND'
      and (
        (replay_attempt_count < 5
          and replay_next_attempt_at is not null
          and replay_terminal_at is null)
        or (replay_attempt_count = 5
          and replay_next_attempt_at is null
          and replay_terminal_at is not null)
      ))
    or (processed_at is null
      and processing_error_code is distinct from 'PROVIDER_MESSAGE_NOT_FOUND'
      and replay_attempt_count = 0
      and replay_last_attempt_at is null
      and replay_next_attempt_at is null
      and replay_terminal_at is null)
  ),
  add constraint email_webhook_events_replay_time_order check (
    (replay_last_attempt_at is null or replay_last_attempt_at >= received_at)
    and (replay_next_attempt_at is null
      or replay_next_attempt_at > replay_last_attempt_at)
    and (replay_terminal_at is null
      or replay_terminal_at >= replay_last_attempt_at)
  );

create index email_webhook_events_replay_eligibility_idx
  on gioia_private.email_webhook_events (
    replay_next_attempt_at, received_at, provider_event_id
  ) where processed_at is null
    and processing_error_code = 'PROVIDER_MESSAGE_NOT_FOUND'
    and replay_terminal_at is null;

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;
set local role gioia_mutator;

create function gioia_private.maintain_email_webhook_replay_lifecycle()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.processed_at is not null then
    new.replay_next_attempt_at := null;
    new.replay_terminal_at := null;
    new.replay_terminal_code := null;
  elsif new.processing_error_code = 'PROVIDER_MESSAGE_NOT_FOUND'
    and (tg_op = 'INSERT'
      or old.processing_error_code is distinct from new.processing_error_code) then
    new.replay_attempt_count := 0;
    new.replay_last_attempt_at := null;
    new.replay_next_attempt_at := statement_timestamp();
    new.replay_terminal_at := null;
    new.replay_terminal_code := null;
  end if;
  return new;
end;
$$;

reset role;

create trigger email_webhook_events_replay_lifecycle_guard
before insert or update on gioia_private.email_webhook_events
for each row execute function gioia_private.maintain_email_webhook_replay_lifecycle();

set local role gioia_mutator;

create or replace function gioia_private.replay_pending_verified_email_webhooks(
  p_batch_size smallint
)
returns table (
  selection_ordinal smallint,
  selected_count smallint,
  provider_event_id text,
  processing_state text,
  error_code text
)
language plpgsql volatile security definer set search_path = '' rows 25 as $$
declare
  v_event_ids text[];
  v_event_id text;
  v_event gioia_private.email_webhook_events%rowtype;
  v_result record;
  v_attempt smallint;
  v_ordinal smallint := 0;
  v_selected_count smallint;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if p_batch_size is null or p_batch_size not between 1 and 25 then
    raise sqlstate 'PT400' using message = 'WEBHOOK_REPLAY_BATCH_INVALID';
  end if;

  select pg_catalog.array_agg(candidate.provider_event_id order by
      candidate.replay_next_attempt_at, candidate.received_at,
      candidate.provider_event_id)
  into v_event_ids
  from (
    select webhook.provider_event_id, webhook.replay_next_attempt_at,
      webhook.received_at
    from gioia_private.email_webhook_events as webhook
    where webhook.processed_at is null
      and webhook.processing_error_code = 'PROVIDER_MESSAGE_NOT_FOUND'
      and webhook.provider_message_id is not null
      and webhook.replay_terminal_at is null
      and webhook.replay_next_attempt_at <= v_now
    order by webhook.replay_next_attempt_at, webhook.received_at,
      webhook.provider_event_id
    limit p_batch_size
    for update skip locked
  ) as candidate;

  v_selected_count := coalesce(
    pg_catalog.cardinality(v_event_ids), 0
  )::smallint;
  if v_selected_count = 0 then return; end if;

  foreach v_event_id in array v_event_ids loop
    v_ordinal := v_ordinal + 1;
    select webhook.* into strict v_event
    from gioia_private.email_webhook_events as webhook
    where webhook.provider_event_id = v_event_id;
    v_attempt := v_event.replay_attempt_count + 1;

    update gioia_private.email_webhook_events as webhook
    set replay_attempt_count = v_attempt,
      replay_last_attempt_at = v_now,
      replay_next_attempt_at = case v_attempt
        when 1 then v_now + interval '1 minute'
        when 2 then v_now + interval '5 minutes'
        when 3 then v_now + interval '15 minutes'
        when 4 then v_now + interval '1 hour'
        else null
      end,
      replay_terminal_at = case when v_attempt = 5 then v_now else null end,
      replay_terminal_code = case when v_attempt = 5
        then 'WEBHOOK_REPLAY_EXHAUSTED' else null end
    where webhook.provider_event_id = v_event_id;

    select replay.processing_state, replay.error_code
    into strict v_result
    from gioia_private.process_verified_email_webhook(
      v_event.provider_event_id, v_event.provider_message_id,
      v_event.event_kind, v_event.payload_sha256, v_event.received_at
    ) as replay;

    selection_ordinal := v_ordinal;
    selected_count := v_selected_count;
    provider_event_id := v_event_id;
    if v_result.processing_state = 'processed' then
      processing_state := 'processed';
      error_code := null;
    elsif v_attempt = 5 then
      processing_state := 'terminal';
      error_code := 'WEBHOOK_REPLAY_EXHAUSTED';
    else
      processing_state := 'retry_scheduled';
      error_code := 'PROVIDER_MESSAGE_NOT_FOUND';
    end if;
    return next;
  end loop;
end;
$$;

reset role;
revoke create on schema gioia_private from gioia_mutator;
revoke all on function gioia_private.maintain_email_webhook_replay_lifecycle()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.maintain_email_webhook_replay_lifecycle()
  to gioia_mutator;
revoke all on function gioia_private.replay_pending_verified_email_webhooks(
  smallint
) from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.replay_pending_verified_email_webhooks(
  smallint
) to app_runtime;
revoke gioia_mutator from postgres;

commit;
