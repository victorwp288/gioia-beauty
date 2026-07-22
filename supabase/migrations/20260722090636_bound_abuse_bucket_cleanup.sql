begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create or replace function gioia_private.consume_public_abuse_bucket(
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

  with candidates as (
    select bucket.action, bucket.scope_kind, bucket.hmac_key_id,
      bucket.scope_hash, bucket.bucket_start
    from gioia_private.public_abuse_buckets as bucket
    where bucket.expires_at <= v_now
    order by bucket.expires_at, bucket.bucket_start
    limit 8
    for update skip locked
  )
  delete from gioia_private.public_abuse_buckets as bucket
  using candidates
  where (bucket.action, bucket.scope_kind, bucket.hmac_key_id,
    bucket.scope_hash, bucket.bucket_start) =
    (candidates.action, candidates.scope_kind, candidates.hmac_key_id,
     candidates.scope_hash, candidates.bucket_start);

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

reset role;

revoke create on schema gioia_private from gioia_mutator;
revoke gioia_mutator from postgres;

commit;
