begin;

grant gioia_mutator to postgres;
set local role gioia_mutator;
set local search_path = extensions, public, pg_catalog;

select plan(7);

insert into gioia_private.public_abuse_buckets (
  action, scope_kind, hmac_key_id, scope_hash, bucket_start, bucket_end,
  request_count, expires_at
)
select 'owner_login', 'network', 'pgtap_gc',
  decode(lpad(to_hex(item), 64, '0'), 'hex'),
  statement_timestamp() - interval '3 days' + item * interval '1 second',
  statement_timestamp() - interval '3 days' + item * interval '1 second'
    + interval '15 minutes',
  1,
  statement_timestamp() - interval '2 days' + item * interval '1 second'
from generate_series(1, 11) as item;

insert into gioia_private.public_abuse_buckets (
  action, scope_kind, hmac_key_id, scope_hash, bucket_start, bucket_end,
  request_count, expires_at
) values (
  'owner_login', 'network', 'pgtap_gc', decode(repeat('fd', 32), 'hex'),
  statement_timestamp(), statement_timestamp() + interval '15 minutes', 1,
  statement_timestamp() + interval '1 day'
);

create temporary table abuse_cleanup_result (
  decision text not null,
  allowed boolean not null,
  remaining integer not null,
  retry_after_seconds integer not null,
  human_verification_required boolean not null
) on commit drop;

insert into abuse_cleanup_result
select result.*
from gioia_private.consume_public_abuse_bucket(
  'owner_login', 'network', 'pgtap_gc',
  decode(repeat('fe', 32), 'hex'), false
) as result;

select results_eq(
  'select * from abuse_cleanup_result',
  $$values ('allowed'::text, true, 9, 0, false)$$,
  'opportunistic cleanup preserves the abuse decision contract'
);

select is(
  (
    select count(*) from gioia_private.public_abuse_buckets
    where hmac_key_id = 'pgtap_gc'
      and expires_at <= statement_timestamp()
  ),
  3::bigint,
  'one consume deletes exactly eight of eleven expired buckets'
);

select is(
  (
    select count(*) from gioia_private.public_abuse_buckets
    where hmac_key_id = 'pgtap_gc'
      and scope_hash = decode(repeat('fd', 32), 'hex')
      and expires_at > statement_timestamp()
  ),
  1::bigint,
  'opportunistic cleanup preserves unexpired buckets'
);

select ok(
  pg_get_functiondef(
    'gioia_private.consume_public_abuse_bucket(text,text,text,bytea,boolean)'
      ::regprocedure
  ) ~* 'order by bucket[.]expires_at, bucket[.]bucket_start[[:space:]]+limit[[:space:]]+8[[:space:]]+for update skip locked',
  'consume locks at most eight oldest expired candidates without waiting'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_index as index_data
    join pg_catalog.pg_class as index_relation
      on index_relation.oid = index_data.indexrelid
    where index_relation.oid =
      'gioia_private.public_abuse_buckets_expiry_idx'::regclass
      and index_data.indisvalid
      and index_data.indisready
      and array(
        select pg_catalog.pg_get_indexdef(
          index_data.indexrelid,
          position,
          true
        )
        from pg_catalog.generate_series(1, index_data.indnkeyatts) as position
        order by position
      ) = array['expires_at', 'bucket_start']::text[]
  ),
  'cleanup candidates use the reviewed expiry ordering index'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'gioia_private'
      and procedure.proname = 'consume_public_abuse_bucket'
      and owner.rolname = 'gioia_mutator'
      and procedure.prosecdef
      and exists (
        select 1 from unnest(procedure.proconfig) as setting
        where setting in ('search_path=', 'search_path=""')
      )
  ),
  'cleanup preserves the low-privilege definer and empty search path'
);

select ok(
  has_function_privilege(
    'app_runtime',
    'gioia_private.consume_public_abuse_bucket(text,text,text,bytea,boolean)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'gioia_private.consume_public_abuse_bucket(text,text,text,bytea,boolean)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'gioia_private.consume_public_abuse_bucket(text,text,text,bytea,boolean)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'gioia_private.consume_public_abuse_bucket(text,text,text,bytea,boolean)',
      'EXECUTE'
    ),
  'cleanup preserves the exact runtime-only execute grant'
);

reset role;
select * from finish();
rollback;
