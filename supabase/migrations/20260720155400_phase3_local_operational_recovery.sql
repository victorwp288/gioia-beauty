begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;
set local role gioia_mutator;

create function gioia_private.replay_pending_verified_email_webhooks(
  p_batch_size smallint
)
returns table (
  selection_ordinal smallint,
  selected_count smallint,
  provider_event_id text,
  processing_state text,
  error_code text
)
language plpgsql
volatile
security definer
set search_path = ''
rows 25
as $$
begin
  if p_batch_size is null or p_batch_size not between 1 and 25 then
    raise sqlstate 'PT400' using message = 'WEBHOOK_REPLAY_BATCH_INVALID';
  end if;

  return query
  with candidates as materialized (
    select webhook.provider_event_id, webhook.provider_message_id,
      webhook.event_kind, webhook.payload_sha256, webhook.received_at
    from gioia_private.email_webhook_events as webhook
    where webhook.processed_at is null
      and webhook.processing_error_code = 'PROVIDER_MESSAGE_NOT_FOUND'
      and webhook.provider_message_id is not null
    order by webhook.received_at, webhook.provider_event_id
    limit p_batch_size
    for update skip locked
  ), replayed as (
    select candidate.provider_event_id,
      result.processing_state, result.error_code
    from candidates as candidate
    cross join lateral gioia_private.process_verified_email_webhook(
      candidate.provider_event_id, candidate.provider_message_id,
      candidate.event_kind, candidate.payload_sha256, candidate.received_at
    ) as result
  )
  select pg_catalog.row_number() over (
      order by replayed.provider_event_id
    )::smallint,
    pg_catalog.count(*) over ()::smallint,
    replayed.provider_event_id, replayed.processing_state, replayed.error_code
  from replayed
  order by replayed.provider_event_id;
end;
$$;

reset role;
revoke create on schema gioia_private from gioia_mutator;

revoke all on function gioia_private.replay_pending_verified_email_webhooks(
  smallint
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.replay_pending_verified_email_webhooks(
  smallint
) to app_runtime;

revoke gioia_mutator from postgres;

commit;
