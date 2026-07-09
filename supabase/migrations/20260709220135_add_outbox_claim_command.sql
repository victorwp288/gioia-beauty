begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.claim_email_outbox(
  p_worker_id text,
  p_batch_size smallint,
  p_lease_seconds smallint
)
returns table (
  outbox_id uuid,
  aggregate_kind text,
  aggregate_id uuid,
  aggregate_version integer,
  recipient_kind text,
  recipient_address text,
  template_kind text,
  template_data jsonb,
  provider_idempotency_key text,
  attempt_count smallint,
  expected_version integer,
  lease_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
rows 25
as $$
begin
  if p_worker_id is null
    or pg_catalog.length(p_worker_id) not between 1 and 100
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
      (
        (candidate.aggregate_kind = 'subscriber' and exists (
          select 1
          from gioia_private.newsletter_subscribers as subscriber
          where subscriber.id = candidate.aggregate_id
            and subscriber.version = candidate.aggregate_version
            and subscriber.status = 'pending'
        ))
        or (candidate.aggregate_kind = 'schedule_entry' and exists (
          select 1
          from gioia_private.schedule_entries as entry
          where entry.id = candidate.aggregate_id
            and candidate.template_data ->> 'client_name' = entry.client_name
            and candidate.template_data ->> 'local_date' = entry.local_date::text
            and candidate.template_data ->> 'start_minutes' = entry.start_minutes::text
            and candidate.template_data ->> 'service_duration_minutes'
              = entry.service_duration_minutes::text
            and candidate.template_data ->> 'service_name'
              = entry.service_name_snapshot
            and candidate.template_data ->> 'variant_name'
              = entry.variant_name_snapshot
            and (
              (candidate.recipient_kind = 'customer'
                and entry.client_email = candidate.recipient_address)
              or (candidate.recipient_kind = 'owner' and exists (
                select 1
                from gioia_private.booking_policy as policy
                where policy.singleton
                  and policy.admin_notification_email = candidate.recipient_address
              ))
            )
            and (
              (candidate.template_kind like 'booking_%'
                and entry.status in ('confirmed', 'completed')
                and not exists (
                  select 1
                  from gioia_private.domain_change_log as later_change
                  where later_change.aggregate_kind = 'schedule_entry'
                    and later_change.aggregate_id = entry.id
                    and later_change.aggregate_version > candidate.aggregate_version
                    and later_change.change_kind in ('reschedule', 'cancel')
                ))
              or (candidate.template_kind like 'reschedule_%'
                and entry.status in ('confirmed', 'completed')
                and not exists (
                  select 1
                  from gioia_private.domain_change_log as later_change
                  where later_change.aggregate_kind = 'schedule_entry'
                    and later_change.aggregate_id = entry.id
                    and later_change.aggregate_version > candidate.aggregate_version
                    and later_change.change_kind in ('reschedule', 'cancel')
                ))
              or (candidate.template_kind like 'cancellation_%'
                and entry.status = 'cancelled')
            )
        ))
      ) as deliverable
    from gioia_private.email_outbox as candidate
    where (
      (candidate.status in ('pending', 'failed')
        and candidate.next_attempt_at <= pg_catalog.statement_timestamp()
        and candidate.attempt_count < 20)
      or (candidate.status = 'sending'
        and candidate.lease_expires_at <= pg_catalog.statement_timestamp())
    )
    order by
      case when candidate.status = 'sending'
        then candidate.lease_expires_at else candidate.next_attempt_at end,
      candidate.created_at,
      candidate.id
    limit p_batch_size
    for update skip locked
  ), changed as (
    update gioia_private.email_outbox as outbox
    set status = case
          when not candidates.deliverable
            or (outbox.status = 'sending' and outbox.attempt_count >= 5)
            then 'dead_letter'
          else 'sending'
        end,
        attempt_count = case
          when not candidates.deliverable
            then pg_catalog.greatest(outbox.attempt_count, 1)
          when outbox.status = 'sending' and outbox.attempt_count >= 5
            then outbox.attempt_count
          else outbox.attempt_count + 1
        end,
        locked_at = case
          when not candidates.deliverable
            or (outbox.status = 'sending' and outbox.attempt_count >= 5)
            then null
          else pg_catalog.statement_timestamp()
        end,
        locked_by = case
          when not candidates.deliverable
            or (outbox.status = 'sending' and outbox.attempt_count >= 5)
            then null
          else p_worker_id
        end,
        lease_expires_at = case
          when not candidates.deliverable
            or (outbox.status = 'sending' and outbox.attempt_count >= 5)
            then null
          else pg_catalog.statement_timestamp()
            + pg_catalog.make_interval(secs => p_lease_seconds)
        end,
        last_error_code = case
          when not candidates.deliverable
            then 'AGGREGATE_STATE_STALE'
          when outbox.status = 'sending' and outbox.attempt_count >= 5
            then 'LEASE_EXPIRED'
          else null
        end,
        next_attempt_at = case
          when not candidates.deliverable
            or (outbox.status = 'sending' and outbox.attempt_count >= 5)
            then pg_catalog.statement_timestamp()
          else outbox.next_attempt_at
        end
    from candidates
    where outbox.id = candidates.id
    returning outbox.*
  )
  select
    changed.id,
    changed.aggregate_kind,
    changed.aggregate_id,
    changed.aggregate_version,
    changed.recipient_kind,
    changed.recipient_address::text,
    changed.template_kind,
    changed.template_data,
    changed.idempotency_key,
    changed.attempt_count,
    changed.version,
    changed.lease_expires_at
  from changed
  where changed.status = 'sending'
  order by changed.created_at, changed.id;
end;
$$;

comment on function gioia_private.claim_email_outbox(text, smallint, smallint) is
  'Claims at most 25 due emails. Recovers leases and dead-letters crashed ceiling attempts.';

reset role;

revoke create on schema gioia_private from gioia_mutator;

revoke all on function gioia_private.claim_email_outbox(text, smallint, smallint)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.claim_email_outbox(text, smallint, smallint)
  to app_runtime;

revoke gioia_mutator from postgres;

commit;
