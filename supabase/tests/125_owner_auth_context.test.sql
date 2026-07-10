begin;
grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;
set local search_path = extensions, public, pg_catalog;
select plan(17);
select ok(
  not has_schema_privilege('gioia_mutator', 'auth', 'USAGE'),
  'the mutator has no dependency on the private Supabase Auth schema'
);
select ok(
  (
    select owner.rolname = 'gioia_mutator'
      and not procedure.prosecdef
      and procedure.provolatile = 's'
      and exists (
        select 1 from unnest(procedure.proconfig) as setting
        where setting in ('search_path=', 'search_path=""')
      )
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where procedure.oid =
      'gioia_private.assert_enabled_owner(uuid)'::regprocedure
  ),
  'owner assertion remains a stable invoker helper owned by the mutator role'
);
select ok(
  pg_get_functiondef(
    'gioia_private.authenticated_owner_session_id(uuid)'::regprocedure
  ) ~ 'request.jwt.claim.sub'
    and pg_get_functiondef(
      'gioia_private.authenticated_owner_session_id(uuid)'::regprocedure
    ) ~ 'request.jwt.claim.session_id'
    and pg_get_functiondef(
      'gioia_private.authenticated_owner_session_id(uuid)'::regprocedure
    ) !~ 'auth.uid\(\)|auth.jwt\(\)'
    and pg_get_functiondef(
      'gioia_private.assert_enabled_owner(uuid)'::regprocedure
    ) ~ 'gioia_private.authenticated_owner_session_id\(p_user_id\)'
    and pg_get_functiondef(
      'gioia_private.assert_enabled_owner(uuid)'::regprocedure
    ) ~ 'gioia_private.owner_accounts'
    and pg_get_functiondef(
      'gioia_private.authorize_owner_session(uuid,uuid)'::regprocedure
    ) ~ 'gioia_private.assert_enabled_owner\(p_actor_user_id\)'
    and pg_get_functiondef(
      'gioia_private.authorize_owner_session(uuid,uuid)'::regprocedure
    ) !~ 'gioia_private.owner_accounts',
  'one central helper binds the verified transaction sub to the allowlist'
);
select ok(
  has_function_privilege(
    'gioia_mutator', 'gioia_private.assert_enabled_owner(uuid)', 'EXECUTE'
    )
    and has_function_privilege(
      'app_runtime', 'gioia_private.authorize_owner_session(uuid,uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'app_runtime', 'gioia_private.assert_enabled_owner(uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'anon', 'gioia_private.assert_enabled_owner(uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated', 'gioia_private.assert_enabled_owner(uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'service_role', 'gioia_private.assert_enabled_owner(uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'gioia_migrator', 'gioia_private.assert_enabled_owner(uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'anon', 'gioia_private.authorize_owner_session(uuid,uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated', 'gioia_private.authorize_owner_session(uuid,uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'service_role', 'gioia_private.authorize_owner_session(uuid,uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'gioia_migrator', 'gioia_private.authorize_owner_session(uuid,uuid)', 'EXECUTE'
    ),
  'only app_runtime can call the PII-free session authorization boundary'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'gioia_private'
      and has_function_privilege('app_runtime', procedure.oid, 'EXECUTE')
      and (
        procedure.proname like 'owner\_%' escape '\'
        or procedure.proname = 'retry_email_outbox_as_owner'
      )
  ),
  11::bigint,
  'all eleven reviewed owner mutation boundaries remain allowlisted'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'gioia_private'
      and has_function_privilege('app_runtime', procedure.oid, 'EXECUTE')
      and (
        procedure.proname like 'owner\_%' escape '\'
        or procedure.proname = 'retry_email_outbox_as_owner'
      )
      and pg_get_functiondef(procedure.oid)
        !~ 'gioia_private.assert_enabled_owner\(p_actor_user_id\)'
  ),
  'every owner mutation reaches the centralized identity assertion first'
);
select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'gioia_private.owner_accounts'::regclass
  )
    and not has_table_privilege(
      'app_runtime', 'gioia_private.owner_accounts', 'SELECT'
    )
    and not has_table_privilege(
      'anon', 'gioia_private.owner_accounts', 'SELECT'
    )
    and not has_table_privilege(
      'authenticated', 'gioia_private.owner_accounts', 'SELECT'
    )
    and not has_table_privilege(
      'service_role', 'gioia_private.owner_accounts', 'SELECT'
    ),
  'the current owner allowlist remains forced-RLS and hidden from callers'
);

do $setup$
declare
  v_date date;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  (
    '00000000-0000-0000-0000-000000000000',
    '95000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'owner@auth-context.test',
    statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, statement_timestamp(), statement_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '95000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'member@auth-context.test',
    statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, statement_timestamp(), statement_timestamp()
  );

  insert into gioia_private.owner_accounts (user_id)
  values ('95000000-0000-4000-8000-000000000001');

  select min(candidate.local_date)::date
  into strict v_date
  from generate_series(
    ((statement_timestamp() at time zone 'Europe/Rome')::date + 1)::timestamp,
    ((statement_timestamp() at time zone 'Europe/Rome')::date + 7)::timestamp,
    interval '1 day'
  ) as candidate(local_date)
  where extract(isodow from candidate.local_date) between 1 and 5;

  perform set_config('gioia.test_owner_auth_date', v_date::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.session_id', '', true);
end
$setup$;
set local role app_runtime;
select throws_ok(
  $$select gioia_private.authorize_owner_session(
    '95000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000001'
  )$$,
  'PT401', 'OWNER_AUTHENTICATION_REQUIRED',
  'session authorization without a Supabase identity returns 401'
);

reset role;
select is(
  (select count(*) from gioia_private.command_requests
    where idempotency_key like 'auth-context:%'),
  0::bigint,
  'missing authentication writes no command state'
);

do $$begin
  perform set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);
  perform set_config('request.jwt.claim.session_id', '96000000-0000-4000-8000-000000000002', true);
end$$;
set local role app_runtime;

select throws_ok(
  $$select gioia_private.authorize_owner_session(
    '95000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000002'
  )$$,
  'PT403', 'OWNER_IDENTITY_MISMATCH',
  'an actor UUID cannot impersonate a different authenticated identity'
);

select throws_ok(
  $$select gioia_private.authorize_owner_session(
    '95000000-0000-4000-8000-000000000002',
    '96000000-0000-4000-8000-000000000002'
  )$$,
  'PT403', 'OWNER_AUTHORIZATION_REQUIRED',
  'an authenticated user outside the current owner allowlist returns 403'
);

reset role;

select is(
  (select count(*) from gioia_private.command_requests
    where idempotency_key like 'auth-context:%'),
  0::bigint,
  'failed session authorization writes no command state'
);

do $$begin
  perform set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.session_id', '96000000-0000-4000-8000-000000000001', true);
end$$;
set local role app_runtime;
select is(
  gioia_private.start_owner_session(
    '95000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000001'
  ),
  true,
  'a matching enabled owner starts one PII-free session'
);
select is(
  (
    select pg_catalog.jsonb_build_object(
      'status', http_status, 'code', result->>'code', 'replayed', replayed
    )
    from gioia_private.owner_create_block(
      '95000000-0000-4000-8000-000000000001', 'auth-context:allowed',
      decode(repeat('94', 32), 'hex'),
      current_setting('gioia.test_owner_auth_date')::date,
      600::smallint, 30::smallint, 0::smallint, 'Auth context test'
    )
  ),
  '{"status": 201, "code": "BLOCK_CREATED", "replayed": false}'::jsonb,
  'a matching enabled owner identity can execute the mutation'
);

reset role;

select is(
  (select count(*) from gioia_private.command_requests
    where idempotency_key like 'auth-context:%'),
  1::bigint,
  'the authorized request creates exactly one command record'
);

update gioia_private.owner_accounts
set enabled = false
where user_id = '95000000-0000-4000-8000-000000000001';

set local role app_runtime;

select throws_ok(
  $$select gioia_private.authorize_owner_session(
    '95000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000001'
  )$$,
  'PT403', 'OWNER_AUTHORIZATION_REQUIRED',
  'disabling the owner allowlist row revokes the next session check immediately'
);

reset role;

select results_eq(
  $$select
      (select count(*) from gioia_private.command_requests
        where idempotency_key like 'auth-context:%'),
      (select count(*) from gioia_private.schedule_entries
        where created_by = '95000000-0000-4000-8000-000000000001'),
      (select count(*) from gioia_private.domain_change_log
        where actor_user_id = '95000000-0000-4000-8000-000000000001')$$,
  $$values (1::bigint, 1::bigint, 1::bigint)$$,
  'revocation leaves exactly the one previously authorized mutation'
);

select * from finish();

rollback;
