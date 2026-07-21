begin;
grant gioia_mutator to postgres;
set local role gioia_mutator;
set local search_path = extensions, public, pg_catalog;
select plan(4);

select results_eq(
  $actual$
    select action, scope_kind, window_seconds, hard_limit,
      challenge_after, retention_seconds
    from gioia_private.public_abuse_policies
    where action = 'owner_login'
    order by scope_kind
  $actual$,
  $expected$
    values
      ('owner_login'::text, 'account'::text, 900, 5, 3, 86400),
      ('owner_login'::text, 'network'::text, 900, 10, 5, 86400)
  $expected$,
  'owner login has exact fifteen-minute account and network abuse policies'
);

create temporary table owner_login_abuse_observations (
  scope_kind text not null,
  attempt integer not null,
  decision text not null,
  allowed boolean not null,
  remaining integer not null,
  retry_after_seconds integer not null,
  human_verification_required boolean not null
) on commit drop;

do $$
declare
  attempt integer;
begin
  for attempt in 1..11 loop
    insert into owner_login_abuse_observations
    select 'network', attempt, result.*
    from gioia_private.consume_public_abuse_bucket(
      'owner_login', 'network', 'pgtap_login_net',
      decode(repeat('11', 32), 'hex'), false
    ) as result;
  end loop;
  for attempt in 1..6 loop
    insert into owner_login_abuse_observations
    select 'account', attempt, result.*
    from gioia_private.consume_public_abuse_bucket(
      'owner_login', 'account', 'pgtap_login_acct',
      decode(repeat('22', 32), 'hex'), false
    ) as result;
  end loop;
end
$$;

select results_eq(
  $actual$
    select attempt, decision, allowed, remaining,
      case
        when retry_after_seconds = 0 then 'zero'
        when retry_after_seconds between 1 and 900 then 'bounded'
        else 'invalid'
      end,
      human_verification_required
    from owner_login_abuse_observations
    where scope_kind = 'network'
    order by attempt
  $actual$,
  $expected$
    values
      (1, 'allowed'::text, true, 9, 'zero'::text, false),
      (2, 'allowed'::text, true, 8, 'zero'::text, false),
      (3, 'allowed'::text, true, 7, 'zero'::text, false),
      (4, 'allowed'::text, true, 6, 'zero'::text, false),
      (5, 'allowed'::text, true, 5, 'zero'::text, false),
      (6, 'human_verification_required'::text, false, 4, 'bounded'::text, true),
      (7, 'human_verification_required'::text, false, 3, 'bounded'::text, true),
      (8, 'human_verification_required'::text, false, 2, 'bounded'::text, true),
      (9, 'human_verification_required'::text, false, 1, 'bounded'::text, true),
      (10, 'human_verification_required'::text, false, 0, 'bounded'::text, true),
      (11, 'rate_limited'::text, false, 0, 'bounded'::text, false)
  $expected$,
  'owner login network attempts challenge after five and hard-limit after ten'
);

select results_eq(
  $actual$
    select attempt, decision, allowed, remaining,
      case
        when retry_after_seconds = 0 then 'zero'
        when retry_after_seconds between 1 and 900 then 'bounded'
        else 'invalid'
      end,
      human_verification_required
    from owner_login_abuse_observations
    where scope_kind = 'account'
    order by attempt
  $actual$,
  $expected$
    values
      (1, 'allowed'::text, true, 4, 'zero'::text, false),
      (2, 'allowed'::text, true, 3, 'zero'::text, false),
      (3, 'allowed'::text, true, 2, 'zero'::text, false),
      (4, 'human_verification_required'::text, false, 1, 'bounded'::text, true),
      (5, 'human_verification_required'::text, false, 0, 'bounded'::text, true),
      (6, 'rate_limited'::text, false, 0, 'bounded'::text, false)
  $expected$,
  'owner login account attempts challenge after three and hard-limit after five'
);

create temporary table owner_login_retry_observation (
  decision text not null,
  allowed boolean not null,
  remaining integer not null,
  retry_after_seconds integer not null,
  human_verification_required boolean not null
) on commit drop;

do $$
declare
  test_now timestamptz := statement_timestamp();
  bucket_start timestamptz;
begin
  bucket_start := to_timestamp(floor(extract(epoch from test_now) / 900) * 900);
  insert into gioia_private.public_abuse_buckets (
    action, scope_kind, hmac_key_id, scope_hash, bucket_start, bucket_end,
    request_count, expires_at
  ) values (
    'owner_login', 'network', 'login_retry',
    decode(repeat('33', 32), 'hex'), bucket_start,
    test_now + interval '42.25 seconds', 10,
    test_now + interval '1 day'
  );
  insert into owner_login_retry_observation
  select result.*
  from gioia_private.consume_public_abuse_bucket(
    'owner_login', 'network', 'login_retry',
    decode(repeat('33', 32), 'hex'), false
  ) as result;
end
$$;

select results_eq(
  'select * from owner_login_retry_observation',
  $$values ('rate_limited'::text, false, 0, 43, false)$$,
  'owner login rate limits return the exact ceiling of the bucket retry delay'
);

reset role;
select * from finish();
rollback;
