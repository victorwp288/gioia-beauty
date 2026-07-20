begin;

set local search_path = extensions, public, pg_catalog;

select plan(5);

create temporary table expected_runtime_functions(signature text primary key) on commit drop;
insert into expected_runtime_functions values
  ('gioia_private.ack_email_dead_letter_alert_batch(text,uuid,bigint)'),
  ('gioia_private.begin_email_outbox_provider_attempt(uuid,integer,text)'),
  ('gioia_private.claim_email_dead_letter_alert_batch(text,smallint,smallint)'),
  ('gioia_private.claim_email_outbox(text,smallint,smallint)'),
  ('gioia_private.complete_email_outbox_failure(uuid,integer,text,text,boolean)'),
  ('gioia_private.complete_email_outbox_pre_provider_failure(uuid,integer,text,text,boolean)'),
  ('gioia_private.complete_email_outbox_success(uuid,integer,text,text)'),
  ('gioia_private.confirm_public_newsletter(uuid,integer,uuid,integer,timestamp with time zone,timestamp with time zone,text,bytea,text,bytea)'),
  ('gioia_private.consume_public_abuse_bucket(text,text,text,bytea,boolean)'),
  ('gioia_private.process_verified_email_webhook(text,text,text,bytea,timestamp with time zone)'),
  ('gioia_private.owner_unsubscribe_subscriber(uuid,text,bytea,uuid,integer)'),
  ('gioia_private.owner_update_vacation(uuid,text,bytea,uuid,integer,date,date,text)'),
  ('gioia_private.retry_email_outbox_as_owner(uuid,text,bytea,uuid,integer)'),
  ('gioia_private.replay_pending_verified_email_webhooks(smallint)'),
  ('gioia_private.purge_expired_public_abuse_buckets(integer)'),
  ('gioia_private.subscribe_public_newsletter(bytea,text,bytea,text)'),
  ('gioia_private.unsubscribe_public_newsletter(uuid,integer,uuid,integer,timestamp with time zone,timestamp with time zone,text,bytea,text,bytea)');

select results_eq(
  $actual$
    select procedure.oid::regprocedure::text
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'gioia_private'
      and has_function_privilege('app_runtime', procedure.oid, 'EXECUTE')
      and procedure.oid::regprocedure::text in (
        select signature from expected_runtime_functions
      )
    order by procedure.oid::regprocedure::text
  $actual$,
  $$select signature from expected_runtime_functions order by signature$$,
  'outbox and subscriber grants match exact reviewed signatures'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as role(role_name)
    where namespace.nspname = 'gioia_private'
      and procedure.oid::regprocedure::text in (
        select signature from expected_runtime_functions
      )
      and has_function_privilege(role.role_name, procedure.oid, 'EXECUTE')
  ),
  'browser and Supabase API roles cannot execute runtime boundaries'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where procedure.oid::regprocedure::text in (
        select signature from expected_runtime_functions
      )
      and (
        owner.rolname <> 'gioia_mutator'
        or not procedure.prosecdef
        or not exists (
          select 1 from unnest(procedure.proconfig) as setting
          where setting in ('search_path=', 'search_path=""')
        )
      )
  ),
  'runtime boundaries are low-privilege definers with an empty search path'
);

select ok(
  not has_table_privilege('app_runtime', 'gioia_private.email_outbox', 'SELECT')
    and not has_table_privilege(
      'app_runtime', 'gioia_private.newsletter_subscribers', 'SELECT'
    )
    and not has_table_privilege(
      'app_runtime', 'gioia_private.email_webhook_events', 'SELECT'
    ),
  'app_runtime reaches private email data only through reviewed functions'
);

select ok(
  not has_function_privilege(
    'app_runtime',
    'gioia_private.maintain_email_webhook_replay_lifecycle()'::regprocedure,
    'EXECUTE'
  ),
  'app_runtime cannot bypass the webhook replay lifecycle trigger'
);

select * from finish();

rollback;
