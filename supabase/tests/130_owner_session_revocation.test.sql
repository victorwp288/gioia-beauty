begin;

grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;
set local search_path = extensions, public, pg_catalog;

select plan(26);

do $setup$
declare v_date date;
begin
  insert into auth.users (
    instance_id,id,aud,role,email,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values
  ('00000000-0000-0000-0000-000000000000',
    'a1000000-0000-4000-8000-000000000001','authenticated','authenticated',
    'owner-a@session-ledger.test',statement_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
    statement_timestamp(),statement_timestamp()),
  ('00000000-0000-0000-0000-000000000000',
    'a1000000-0000-4000-8000-000000000002','authenticated','authenticated',
    'owner-b@session-ledger.test',statement_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
    statement_timestamp(),statement_timestamp());
  insert into gioia_private.owner_accounts(user_id) values
    ('a1000000-0000-4000-8000-000000000001'),
    ('a1000000-0000-4000-8000-000000000002');
  select min(candidate.local_date)::date into strict v_date
  from generate_series(
    ((statement_timestamp() at time zone 'Europe/Rome')::date+1)::timestamp,
    ((statement_timestamp() at time zone 'Europe/Rome')::date+7)::timestamp,
    interval '1 day') as candidate(local_date)
  where extract(isodow from candidate.local_date) between 1 and 5;
  perform set_config('gioia.test_session_date',v_date::text,true);
  perform set_config('request.jwt.claim.sub',
    'a1000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claim.session_id','',true);
end
$setup$;

set local role app_runtime;
select throws_ok(
  $$select gioia_private.authorize_owner_session(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001')$$,
  'PT401','OWNER_SESSION_REQUIRED',
  'missing transaction-local session identity is authentication failure'
);
select throws_ok(
  $$select * from gioia_private.owner_create_block(
    'a1000000-0000-4000-8000-000000000001','session:no-ledger',
    decode(repeat('d1',32),'hex'),current_setting('gioia.test_session_date')::date,
    600::smallint,30::smallint,0::smallint,'Session ledger test')$$,
  'PT401','OWNER_SESSION_REQUIRED',
  'an owner mutation without session identity fails before command state'
);
reset role;
select is((select count(*) from gioia_private.command_requests
  where idempotency_key like 'session:%'),0::bigint,
  'missing session identity creates no command row');

do $$begin
  perform set_config('request.jwt.claim.session_id',
    'b1000000-0000-4000-8000-000000000002',true);
end$$;
set local role app_runtime;
select throws_ok(
  $$select * from gioia_private.owner_create_block(
    'a1000000-0000-4000-8000-000000000001','session:no-start',
    decode(repeat('d0',32),'hex'),current_setting('gioia.test_session_date')::date,
    600::smallint,30::smallint,0::smallint,'Session ledger test')$$,
  'PT401','OWNER_SESSION_REQUIRED',
  'valid owner identity without a started ledger session cannot mutate'
);
select throws_ok(
  $$select gioia_private.start_owner_session(
    'a1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001')$$,
  'PT403','OWNER_SESSION_MISMATCH',
  'a supplied session cannot differ from the authenticated session claim'
);
reset role;

do $$begin perform set_config('request.jwt.claim.session_id',
  'b1000000-0000-4000-8000-000000000001',true); end$$;
set local role app_runtime;
select results_eq($$select gioia_private.start_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001')$$,$$values(true)$$,
  'enabled owner starts one session');
select results_eq($$select gioia_private.start_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001')$$,$$values(true)$$,
  'starting the same active session is idempotent');
select results_eq($$select gioia_private.authorize_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001')$$,$$values(true)$$,
  'active matching session authorizes one PII-free boolean');
select results_eq(
  $$select http_status,result->>'code' from gioia_private.owner_create_block(
    'a1000000-0000-4000-8000-000000000001','session:active',
    decode(repeat('d2',32),'hex'),current_setting('gioia.test_session_date')::date,
    600::smallint,30::smallint,0::smallint,'Session ledger test')$$,
  $$values(201::smallint,'BLOCK_CREATED'::text)$$,
  'active ledger session permits an existing owner mutation');
reset role;

select results_eq($$select user_id,expires_at-created_at,revoked_at is null
  from gioia_private.owner_sessions
  where session_id='b1000000-0000-4000-8000-000000000001'$$,
  $$values('a1000000-0000-4000-8000-000000000001'::uuid,
    interval '12 hours',true)$$,
  'started session is owner-bound, unrevoked, and twelve-hour bounded');
select results_eq($$select
  (select count(*) from gioia_private.owner_sessions),
  (select count(*) from gioia_private.command_requests
    where idempotency_key like 'session:%'),
  (select count(*) from gioia_private.schedule_entries where created_by=
    'a1000000-0000-4000-8000-000000000001')$$,
  $$values(1::bigint,1::bigint,1::bigint)$$,
  'idempotent start and active mutation create exact bounded writes');

do $$begin
  perform set_config('request.jwt.claim.sub',
    'a1000000-0000-4000-8000-000000000002',true);
end$$;
set local role app_runtime;
select throws_ok($$select gioia_private.start_owner_session(
  'a1000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001')$$,
  'PT403','OWNER_SESSION_MISMATCH',
  'a session UUID already bound to another owner cannot be claimed');
reset role;

update gioia_private.owner_accounts set enabled=false
where user_id='a1000000-0000-4000-8000-000000000001';
do $$begin perform set_config('request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',true); end$$;
set local role app_runtime;
select throws_ok($$select gioia_private.authorize_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001')$$,
  'PT403','OWNER_AUTHORIZATION_REQUIRED',
  'disabled owner cannot authorize an otherwise active session');
select results_eq($$select gioia_private.revoke_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001')$$,$$values(true)$$,
  'matching authenticated actor can revoke after owner disablement');
reset role;
do $$begin perform set_config('gioia.test_revoked_at',(select revoked_at::text
  from gioia_private.owner_sessions where session_id=
  'b1000000-0000-4000-8000-000000000001'),true); end$$;
set local role app_runtime;
select results_eq($$select gioia_private.revoke_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001')$$,$$values(true)$$,
  'repeated revocation is idempotent');
reset role;
select is((select revoked_at::text from gioia_private.owner_sessions where
  session_id='b1000000-0000-4000-8000-000000000001'),
  current_setting('gioia.test_revoked_at'),'replay preserves first revocation time');

update gioia_private.owner_accounts set enabled=true
where user_id='a1000000-0000-4000-8000-000000000001';
set local role app_runtime;
select throws_ok($$select gioia_private.authorize_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001')$$,
  'PT401','OWNER_SESSION_REVOKED','revoked session cannot authorize');
select throws_ok($$select * from gioia_private.owner_create_block(
  'a1000000-0000-4000-8000-000000000001','session:revoked',
  decode(repeat('d3',32),'hex'),current_setting('gioia.test_session_date')::date,
  660::smallint,30::smallint,0::smallint,'Session ledger test')$$,
  'PT401','OWNER_SESSION_REVOKED','revoked session cannot mutate');
select throws_ok($$select gioia_private.start_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001')$$,
  'PT401','OWNER_SESSION_REVOKED','login replay cannot resurrect revocation');
reset role;
select is((select count(*) from gioia_private.command_requests
  where idempotency_key like 'session:%'),1::bigint,
  'revoked mutation creates no command row');

insert into gioia_private.owner_sessions(
  session_id,user_id,created_at,expires_at
) values ('b1000000-0000-4000-8000-000000000003',
  'a1000000-0000-4000-8000-000000000001',statement_timestamp()-interval '2 hours',
  statement_timestamp()-interval '1 hour');
do $$begin perform set_config('request.jwt.claim.session_id',
  'b1000000-0000-4000-8000-000000000003',true); end$$;
set local role app_runtime;
select throws_ok($$select gioia_private.authorize_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000003')$$,
  'PT401','OWNER_SESSION_EXPIRED','expired session cannot authorize');
select throws_ok($$select * from gioia_private.owner_create_block(
  'a1000000-0000-4000-8000-000000000001','session:expired',
  decode(repeat('d4',32),'hex'),current_setting('gioia.test_session_date')::date,
  720::smallint,30::smallint,0::smallint,'Session ledger test')$$,
  'PT401','OWNER_SESSION_EXPIRED','expired session cannot mutate');
reset role;
select is((select count(*) from gioia_private.command_requests
  where idempotency_key like 'session:%'),1::bigint,
  'expired mutation creates no command row');

do $$begin perform set_config('request.jwt.claim.session_id',
  'b1000000-0000-4000-8000-000000000099',true); end$$;
set local role app_runtime;
select results_eq($$select gioia_private.revoke_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000099')$$,$$values(true)$$,
  'revoking an absent matching session creates a safe tombstone');
select throws_ok($$select gioia_private.start_owner_session(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000099')$$,
  'PT401','OWNER_SESSION_REVOKED','a revoke-before-start race cannot resurrect');
reset role;
select results_eq($$select count(*),count(*) filter(where revoked_at is not null)
  from gioia_private.owner_sessions$$,$$values(3::bigint,2::bigint)$$,
  'absent-session revoke persists exactly one revoked tombstone');

select * from finish();
rollback;
