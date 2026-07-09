begin;

set local search_path = extensions, public, pg_catalog;

select plan(15);

select has_schema('gioia_private', 'private application schema exists');

select is(
  (
    select count(*)
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname in ('btree_gist', 'citext', 'pgcrypto', 'pgtap')
      and namespace.nspname = 'extensions'
  ),
  4::bigint,
  'all required extensions are installed in extensions'
);

select is(
  (select count(*) from pg_catalog.pg_roles where rolname in (
    'app_runtime', 'gioia_mutator', 'gioia_migrator'
  )),
  3::bigint,
  'all application roles exist'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname in ('app_runtime', 'gioia_mutator', 'gioia_migrator')
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole
        or rolinherit or rolreplication or rolbypassrls)
  ),
  'application roles have no login or elevated attributes'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    where granted_role.rolname in ('app_runtime', 'gioia_mutator', 'gioia_migrator')
      and member_role.rolname in (
        'app_runtime', 'gioia_mutator', 'gioia_migrator',
        'anon', 'authenticated', 'service_role'
      )
  ),
  'runtime, mutator, migrator, and API roles have no cross-membership'
);

select ok(
  has_schema_privilege('app_runtime', 'gioia_private', 'USAGE')
    and has_schema_privilege('gioia_mutator', 'gioia_private', 'USAGE')
    and has_schema_privilege('gioia_migrator', 'gioia_private', 'USAGE')
    and not has_schema_privilege('anon', 'gioia_private', 'USAGE')
    and not has_schema_privilege('authenticated', 'gioia_private', 'USAGE')
    and not has_schema_privilege('service_role', 'gioia_private', 'USAGE'),
  'only internal application roles can resolve the private schema'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_namespace as namespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
    ) as access
    where namespace.nspname = 'gioia_private'
      and access.grantee = 0
  ),
  'PUBLIC has no private-schema ACL'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'gioia_private'
      and relation.relkind in ('r', 'p')
      and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  ),
  'every private table has RLS enabled and forced'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) as access
    left join pg_catalog.pg_roles as grantee on grantee.oid = access.grantee
    where namespace.nspname = 'gioia_private'
      and relation.relkind in ('r', 'p')
      and (access.grantee = 0 or grantee.rolname in (
        'anon', 'authenticated', 'service_role', 'app_runtime'
      ))
  ),
  'PUBLIC, API roles, and app_runtime have no direct table ACLs'
);

with expected(table_name, privilege_type) as (
  values
    ('booking_policy', 'SELECT'), ('booking_policy', 'UPDATE'),
    ('business_hours', 'INSERT'), ('business_hours', 'SELECT'), ('business_hours', 'UPDATE'),
    ('command_requests', 'DELETE'), ('command_requests', 'INSERT'),
    ('command_requests', 'SELECT'), ('command_requests', 'UPDATE'),
    ('domain_change_log', 'INSERT'), ('domain_change_log', 'SELECT'),
    ('email_outbox', 'INSERT'), ('email_outbox', 'SELECT'), ('email_outbox', 'UPDATE'),
    ('email_webhook_events', 'INSERT'), ('email_webhook_events', 'SELECT'),
    ('email_webhook_events', 'UPDATE'),
    ('newsletter_subscribers', 'INSERT'), ('newsletter_subscribers', 'SELECT'),
    ('newsletter_subscribers', 'UPDATE'),
    ('owner_accounts', 'INSERT'), ('owner_accounts', 'SELECT'), ('owner_accounts', 'UPDATE'),
    ('schedule_day_locks', 'INSERT'), ('schedule_day_locks', 'SELECT'),
    ('schedule_entries', 'INSERT'), ('schedule_entries', 'SELECT'), ('schedule_entries', 'UPDATE'),
    ('service_categories', 'INSERT'), ('service_categories', 'SELECT'),
    ('service_categories', 'UPDATE'),
    ('service_variants', 'INSERT'), ('service_variants', 'SELECT'),
    ('service_variants', 'UPDATE'),
    ('services', 'INSERT'), ('services', 'SELECT'), ('services', 'UPDATE'),
    ('vacations', 'INSERT'), ('vacations', 'SELECT'), ('vacations', 'UPDATE')
), actual as (
  select relation.relname::text as table_name, access.privilege_type
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  cross join lateral pg_catalog.aclexplode(relation.relacl) as access
  join pg_catalog.pg_roles as grantee on grantee.oid = access.grantee
  where namespace.nspname = 'gioia_private'
    and relation.relkind in ('r', 'p')
    and grantee.rolname = 'gioia_mutator'
), difference as (
  (select * from expected except select * from actual)
  union all
  (select * from actual except select * from expected)
)
select is((select count(*) from difference), 0::bigint, 'mutator table ACLs are exact');

with expected(table_name, privilege_type) as (
  values
    ('domain_change_log', 'INSERT'), ('domain_change_log', 'SELECT'),
    ('migration_quarantine', 'INSERT'), ('migration_quarantine', 'SELECT'),
    ('migration_quarantine', 'UPDATE'),
    ('migration_records', 'INSERT'), ('migration_records', 'SELECT'),
    ('migration_runs', 'INSERT'), ('migration_runs', 'SELECT'), ('migration_runs', 'UPDATE')
), actual as (
  select relation.relname::text as table_name, access.privilege_type
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  cross join lateral pg_catalog.aclexplode(relation.relacl) as access
  join pg_catalog.pg_roles as grantee on grantee.oid = access.grantee
  where namespace.nspname = 'gioia_private'
    and relation.relkind in ('r', 'p')
    and grantee.rolname = 'gioia_migrator'
), difference as (
  (select * from expected except select * from actual)
  union all
  (select * from actual except select * from expected)
)
select is((select count(*) from difference), 0::bigint, 'migrator table ACLs are exact');

select ok(
  has_sequence_privilege(
    'gioia_mutator', 'gioia_private.domain_change_log_sequence_id_seq', 'USAGE'
  ),
  'mutator can allocate immutable audit-log identities'
);

select ok(
  has_sequence_privilege(
    'gioia_migrator', 'gioia_private.migration_quarantine_id_seq', 'USAGE'
  ),
  'migrator can allocate quarantine-ledger identities'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(relation.relacl, pg_catalog.acldefault('S', relation.relowner))
    ) as access
    left join pg_catalog.pg_roles as grantee on grantee.oid = access.grantee
    where namespace.nspname = 'gioia_private'
      and relation.relkind = 'S'
      and (access.grantee = 0 or grantee.rolname in (
        'anon', 'authenticated', 'service_role', 'app_runtime'
      ))
  ),
  'PUBLIC, API roles, and app_runtime have no direct sequence ACLs'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relkind in ('r', 'p')
  ),
  0::bigint,
  'the exposed public schema contains no application tables'
);

select * from finish();

rollback;
