begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.claim_email_dead_letter_alert_batch(
  p_worker_id text,
  p_batch_size smallint,
  p_lease_seconds smallint
)
returns table (
  batch_id uuid,
  from_sequence_id bigint,
  through_sequence_id bigint,
  high_water_sequence_id bigint,
  event_count smallint,
  has_more boolean,
  lease_expires_at timestamptz,
  events jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
rows 1
as $$
declare
  v_state gioia_private.email_dead_letter_monitor_state%rowtype;
  v_batch_id uuid;
  v_from bigint;
  v_through bigint;
  v_high_water bigint;
  v_count smallint;
  v_events jsonb;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if p_worker_id is null or pg_catalog.length(p_worker_id) not between 1 and 100
    or p_worker_id !~ '^[A-Za-z0-9:_-]+$' then
    raise sqlstate 'PT400' using message = 'DEAD_LETTER_WORKER_INVALID';
  end if;
  if p_batch_size is null or p_batch_size not between 1 and 25
    or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise sqlstate 'PT400' using message = 'DEAD_LETTER_BATCH_INVALID';
  end if;
  select state.* into strict v_state
  from gioia_private.email_dead_letter_monitor_state as state
  where state.monitor_name = 'operator_alert_v1'
  for update;
  if v_state.lease_expires_at is not null and v_state.lease_expires_at > v_now then
    raise sqlstate 'PT409' using message = 'DEAD_LETTER_BATCH_LEASED';
  end if;
  v_from := v_state.acked_sequence_id + 1;
  select pg_catalog.max(event.sequence_id) into v_high_water
  from gioia_private.email_dead_letter_events as event;
  v_high_water := coalesce(v_high_water, v_state.acked_sequence_id);
  select pg_catalog.count(*)::smallint, pg_catalog.max(selected.sequence_id),
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'sequenceId', selected.sequence_id,
        'outboxId', selected.outbox_id::text,
        'reasonCode', selected.reason_code,
        'origin', selected.origin,
        'occurredAt', pg_catalog.to_char(
          selected.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ) order by selected.sequence_id
    ), '[]'::jsonb)
  into v_count, v_through, v_events
  from (
    select event.* from gioia_private.email_dead_letter_events as event
    where event.sequence_id > v_state.acked_sequence_id
    order by event.sequence_id
    limit p_batch_size
  ) as selected;
  if v_count = 0 then
    return query select null::uuid, null::bigint, null::bigint, v_high_water,
      0::smallint, false, null::timestamptz, '[]'::jsonb;
    return;
  end if;
  v_batch_id := extensions.gen_random_uuid();
  update gioia_private.email_dead_letter_monitor_state as state
  set batch_id = v_batch_id, locked_by = p_worker_id,
      leased_through_sequence_id = v_through,
      lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds)
  where state.monitor_name = 'operator_alert_v1'
  returning state.* into strict v_state;
  return query select v_batch_id, v_from, v_through, v_high_water, v_count,
    v_through < v_high_water, v_state.lease_expires_at, v_events;
end;
$$;

create function gioia_private.ack_email_dead_letter_alert_batch(
  p_worker_id text,
  p_batch_id uuid,
  p_through_sequence_id bigint
)
returns table (
  acked_sequence_id bigint,
  high_water_sequence_id bigint,
  has_more boolean
)
language plpgsql
volatile
security definer
set search_path = ''
rows 1
as $$
declare
  v_state gioia_private.email_dead_letter_monitor_state%rowtype;
  v_high_water bigint;
begin
  select state.* into strict v_state
  from gioia_private.email_dead_letter_monitor_state as state
  where state.monitor_name = 'operator_alert_v1'
  for update;
  if v_state.batch_id is distinct from p_batch_id
    or v_state.locked_by is distinct from p_worker_id
    or v_state.leased_through_sequence_id is distinct from p_through_sequence_id
    or v_state.lease_expires_at <= pg_catalog.statement_timestamp() then
    raise sqlstate 'PT409' using message = 'DEAD_LETTER_ACK_STALE';
  end if;
  update gioia_private.email_dead_letter_monitor_state as state
  set acked_sequence_id = p_through_sequence_id,
      batch_id = null, locked_by = null,
      leased_through_sequence_id = null, lease_expires_at = null
  where state.monitor_name = 'operator_alert_v1'
  returning state.* into strict v_state;
  select coalesce(pg_catalog.max(event.sequence_id), v_state.acked_sequence_id)
  into v_high_water from gioia_private.email_dead_letter_events as event;
  return query select v_state.acked_sequence_id, v_high_water,
    v_state.acked_sequence_id < v_high_water;
end;
$$;

create function gioia_private.consume_public_abuse_bucket(
  p_action text,
  p_scope_kind text,
  p_hmac_key_id text,
  p_scope_hash bytea,
  p_human_verified boolean
)
returns table (
  decision text,
  allowed boolean,
  remaining integer,
  retry_after_seconds integer,
  human_verification_required boolean
)
language plpgsql
volatile
security definer
set search_path = ''
rows 1
as $$
declare
  v_policy gioia_private.public_abuse_policies%rowtype;
  v_bucket gioia_private.public_abuse_buckets%rowtype;
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_start timestamptz;
begin
  if p_human_verified is null or p_hmac_key_id is null
    or p_hmac_key_id !~ '^[A-Za-z0-9_]{1,16}$'
    or p_scope_hash is null or pg_catalog.octet_length(p_scope_hash) <> 32 then
    raise sqlstate 'PT400' using message = 'ABUSE_SCOPE_INVALID';
  end if;
  select policy.* into v_policy
  from gioia_private.public_abuse_policies as policy
  where policy.action = p_action and policy.scope_kind = p_scope_kind;
  if not found then raise sqlstate 'PT400' using message = 'ABUSE_POLICY_INVALID'; end if;
  v_start := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from v_now) / v_policy.window_seconds)
      * v_policy.window_seconds
  );
  insert into gioia_private.public_abuse_buckets (
    action, scope_kind, hmac_key_id, scope_hash, bucket_start, bucket_end,
    request_count, expires_at
  ) values (
    p_action, p_scope_kind, p_hmac_key_id, p_scope_hash, v_start,
    v_start + pg_catalog.make_interval(secs => v_policy.window_seconds), 1,
    v_start + pg_catalog.make_interval(secs => v_policy.retention_seconds)
  ) on conflict (action, scope_kind, hmac_key_id, scope_hash, bucket_start)
  do update set request_count = gioia_private.public_abuse_buckets.request_count + 1,
    updated_at = v_now
  returning * into strict v_bucket;
  if v_bucket.request_count > v_policy.hard_limit then
    return query select 'rate_limited'::text, false, 0,
      greatest(1, pg_catalog.ceil(
        extract(epoch from v_bucket.bucket_end - v_now)
      )::integer), false;
  elsif v_policy.challenge_after is not null
    and v_bucket.request_count > v_policy.challenge_after and not p_human_verified then
    return query select 'human_verification_required'::text, false,
      greatest(v_policy.hard_limit - v_bucket.request_count, 0),
      greatest(1, pg_catalog.ceil(
        extract(epoch from v_bucket.bucket_end - v_now)
      )::integer), true;
  else
    return query select 'allowed'::text, true,
      greatest(v_policy.hard_limit - v_bucket.request_count, 0),
      0, false;
  end if;
end;
$$;

create function gioia_private.purge_expired_public_abuse_buckets(p_limit integer)
returns table (deleted_count integer, has_more boolean)
language plpgsql
volatile
security definer
set search_path = ''
rows 1
as $$
declare v_deleted integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise sqlstate 'PT400' using message = 'ABUSE_PURGE_LIMIT_INVALID';
  end if;
  with candidates as (
    select bucket.action, bucket.scope_kind, bucket.hmac_key_id,
      bucket.scope_hash, bucket.bucket_start
    from gioia_private.public_abuse_buckets as bucket
    where bucket.expires_at <= pg_catalog.statement_timestamp()
    order by bucket.expires_at, bucket.bucket_start
    limit p_limit
    for update skip locked
  ), removed as (
    delete from gioia_private.public_abuse_buckets as bucket
    using candidates
    where (bucket.action, bucket.scope_kind, bucket.hmac_key_id,
      bucket.scope_hash, bucket.bucket_start) =
      (candidates.action, candidates.scope_kind, candidates.hmac_key_id,
       candidates.scope_hash, candidates.bucket_start)
    returning 1
  ) select pg_catalog.count(*)::integer into v_deleted from removed;
  return query select v_deleted, exists (
    select 1 from gioia_private.public_abuse_buckets as bucket
    where bucket.expires_at <= pg_catalog.statement_timestamp()
  );
end;
$$;


reset role;

revoke create on schema gioia_private from gioia_mutator;

commit;
