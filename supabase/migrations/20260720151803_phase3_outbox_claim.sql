begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

drop function gioia_private.claim_email_outbox(text,smallint,smallint);

create function gioia_private.claim_email_outbox(
  p_worker_id text,
  p_batch_size smallint,
  p_lease_seconds smallint
)
returns table (
  selection_ordinal smallint,
  selected_count smallint,
  candidate_limit_reached boolean,
  outbox_id uuid,
  disposition text,
  terminal_reason text,
  aggregate_kind text,
  aggregate_id uuid,
  aggregate_version integer,
  recipient_kind text,
  recipient_address text,
  template_kind text,
  template_version smallint,
  template_data jsonb,
  provider_idempotency_key text,
  attempt_count smallint,
  expected_version integer,
  lease_expires_at timestamptz,
  first_provider_attempt_at timestamptz,
  provider_retry_deadline_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
rows 25
as $$
begin
  if p_worker_id is null or pg_catalog.length(p_worker_id) not between 1 and 100
    or p_worker_id !~ '^[A-Za-z0-9:_-]+$' then
    raise sqlstate 'PT400' using message = 'OUTBOX_WORKER_INVALID';
  end if;
  if p_batch_size is null or p_batch_size not between 1 and 25 then
    raise sqlstate 'PT400' using message = 'OUTBOX_BATCH_INVALID';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise sqlstate 'PT400' using message = 'OUTBOX_LEASE_INVALID';
  end if;

  return query
  with candidates as (
    select candidate.id,
      case
        when candidate.provider_retry_deadline_at is not null
          and candidate.provider_retry_deadline_at <= pg_catalog.statement_timestamp()
          then 'PROVIDER_RETRY_WINDOW_EXPIRED'
        when candidate.aggregate_kind = 'subscriber' and action.expires_at is null
          then 'AGGREGATE_STATE_STALE'
        when candidate.aggregate_kind = 'subscriber'
          and action.expires_at <= pg_catalog.statement_timestamp()
          then 'NEWSLETTER_ACTION_EXPIRED'
        when candidate.aggregate_kind = 'subscriber'
          and action.expires_at < pg_catalog.statement_timestamp() + interval '15 minutes'
          then 'NEWSLETTER_ACTION_LIFETIME_TOO_SHORT'
        when candidate.status = 'sending' and candidate.attempt_count >= 5
          then 'LEASE_ATTEMPTS_EXHAUSTED'
        when not (
          (candidate.aggregate_kind = 'subscriber' and exists (
            select 1 from gioia_private.newsletter_subscribers as subscriber
            where subscriber.id = candidate.aggregate_id
              and subscriber.version = candidate.aggregate_version
              and subscriber.status = 'pending'
          ))
          or (candidate.aggregate_kind = 'schedule_entry' and exists (
            select 1 from gioia_private.schedule_entries as entry
            where entry.id = candidate.aggregate_id
              and candidate.template_data ->> 'client_name' = entry.client_name
              and candidate.template_data ->> 'local_date' = entry.local_date::text
              and candidate.template_data ->> 'start_minutes' = entry.start_minutes::text
              and candidate.template_data ->> 'service_duration_minutes' = entry.service_duration_minutes::text
              and candidate.template_data ->> 'service_name' = entry.service_name_snapshot
              and candidate.template_data ->> 'variant_name' = entry.variant_name_snapshot
              and ((candidate.recipient_kind = 'customer' and entry.client_email = candidate.recipient_address)
                or (candidate.recipient_kind = 'owner' and exists (
                  select 1 from gioia_private.booking_policy as policy
                  where policy.singleton and policy.admin_notification_email = candidate.recipient_address
                )))
              and ((candidate.template_kind like 'booking_%' and entry.status in ('confirmed','completed'))
                or (candidate.template_kind like 'reschedule_%' and entry.status in ('confirmed','completed'))
                or (candidate.template_kind like 'cancellation_%' and entry.status = 'cancelled'))
          ))
        ) then 'AGGREGATE_STATE_STALE'
        else null
      end as terminal_reason
    from gioia_private.email_outbox as candidate
    left join lateral (
      select token.expires_at
      from gioia_private.newsletter_action_tokens as token
      where token.token_id = candidate.newsletter_action_token_id
        and token.subscriber_id = candidate.aggregate_id
        and token.subscriber_version = candidate.aggregate_version
        and token.purpose = 'newsletter_confirm'
        and token.consumed_at is null
    ) as action on true
    where (
      (candidate.status in ('pending','failed')
        and candidate.next_attempt_at <= pg_catalog.statement_timestamp()
        and candidate.attempt_count < 20)
      or (candidate.status = 'sending'
        and candidate.lease_expires_at <= pg_catalog.statement_timestamp())
    )
    order by case when candidate.status = 'sending'
      then candidate.lease_expires_at else candidate.next_attempt_at end,
      candidate.created_at, candidate.id
    limit p_batch_size
    for update of candidate skip locked
  ), changed as (
    update gioia_private.email_outbox as outbox
    set status = case when candidates.terminal_reason is null then 'sending' else 'dead_letter' end,
        attempt_count = case when candidates.terminal_reason is null
          then outbox.attempt_count + 1 else greatest(outbox.attempt_count, 1) end,
        locked_at = case when candidates.terminal_reason is null
          then pg_catalog.statement_timestamp() else null end,
        locked_by = case when candidates.terminal_reason is null then p_worker_id else null end,
        lease_expires_at = case when candidates.terminal_reason is null
          then pg_catalog.statement_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds)
          else null end,
        last_error_code = candidates.terminal_reason,
        next_attempt_at = case when candidates.terminal_reason is null
          then outbox.next_attempt_at else pg_catalog.statement_timestamp() end
    from candidates
    where outbox.id = candidates.id
    returning outbox.*, candidates.terminal_reason
  ), numbered as (
    select changed.*,
      pg_catalog.row_number() over (order by changed.created_at, changed.id)::smallint as ordinal,
      pg_catalog.count(*) over ()::smallint as total_selected
    from changed
  )
  select numbered.ordinal, numbered.total_selected,
    numbered.total_selected = p_batch_size, numbered.id,
    case when numbered.status = 'sending' then 'send' else 'dead_letter' end,
    numbered.terminal_reason,
    case when numbered.status = 'sending' then numbered.aggregate_kind else null end,
    case when numbered.status = 'sending' then numbered.aggregate_id else null end,
    case when numbered.status = 'sending' then numbered.aggregate_version else null end,
    case when numbered.status = 'sending' then numbered.recipient_kind else null end,
    case when numbered.status = 'sending' then numbered.recipient_address::text else null end,
    case when numbered.status = 'sending' then numbered.template_kind else null end,
    case when numbered.status = 'sending' then numbered.template_version else null end,
    case when numbered.status = 'sending' then numbered.template_data else null end,
    case when numbered.status = 'sending' then numbered.idempotency_key else null end,
    numbered.attempt_count, numbered.version, numbered.lease_expires_at,
    numbered.first_provider_attempt_at, numbered.provider_retry_deadline_at
  from numbered
  order by numbered.ordinal;
end;
$$;


reset role;

revoke create on schema gioia_private from gioia_mutator;

commit;
