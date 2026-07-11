export const GREENFIELD_TEST_OWNER = Object.freeze({
  id: "51000000-0000-4000-8000-000000000001",
  identityId: "52000000-0000-4000-8000-000000000001",
  email: "owner.greenfield@gioia.test",
});
export const GREENFIELD_CONCURRENCY_OWNER = Object.freeze({
  id: "d0000000-0000-4000-8000-000000000001",
  sessionId: "d1000000-0000-4000-8000-000000000001",
});
export const GREENFIELD_RACE_COMMAND_KEYS = Object.freeze([
  ...Array.from(
    { length: 20 },
    (_, index) => `race-distinct-${String(index + 1).padStart(2, "0")}`,
  ),
  "race-identical-key",
  "race-booking-vacation-book",
  "race-booking-vacation-close",
  "race-swap-create-a",
  "race-swap-create-b",
  "race-swap-reschedule-a",
  "race-swap-reschedule-b",
]);
export const GREENFIELD_SCHEDULE_NOTES = Object.freeze([
  "synthetic-distinct-key-race",
  "synthetic-identical-key-race",
  "synthetic-booking-vacation-race",
  "synthetic-reschedule-swap-a",
  "synthetic-reschedule-swap-b",
]);
export const GREENFIELD_VACATION_REASON = "Synthetic booking vacation race";
export const GREENFIELD_EXPECTED_ROLE_NAMES = Object.freeze([
  "anon",
  "app_runtime",
  "authenticated",
  "authenticator",
  "dashboard_user",
  "gioia_migrator",
  "gioia_mutator",
  "pg_checkpoint",
  "pg_create_subscription",
  "pg_database_owner",
  "pg_execute_server_program",
  "pg_maintain",
  "pg_monitor",
  "pg_read_all_data",
  "pg_read_all_settings",
  "pg_read_all_stats",
  "pg_read_server_files",
  "pg_signal_backend",
  "pg_stat_scan_tables",
  "pg_use_reserved_connections",
  "pg_write_all_data",
  "pg_write_server_files",
  "pgbouncer",
  "postgres",
  "service_role",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_etl_admin",
  "supabase_privileged_role",
  "supabase_read_only_user",
  "supabase_realtime_admin",
  "supabase_replication_admin",
  "supabase_storage_admin",
]);
export const GREENFIELD_EXPECTED_SCHEMA_NAMES = Object.freeze([
  "auth",
  "extensions",
  "gioia_private",
  "graphql",
  "graphql_public",
  "information_schema",
  "pg_catalog",
  "pg_toast",
  "pgbouncer",
  "public",
  "realtime",
  "storage",
  "supabase_migrations",
  "vault",
]);

export const GREENFIELD_STATE_SQL = `
  select
    (select array_agg(version::text order by version::text)
      from supabase_migrations.schema_migrations) as migration_versions,
    (select array_agg(rolname order by rolname) from pg_catalog.pg_roles)
      as role_names,
    (select array_agg(nspname order by nspname)
      from pg_catalog.pg_namespace
      where nspname !~ '^pg_temp_' and nspname !~ '^pg_toast_temp_')
      as schema_names,
    (select count(*)::integer from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'gioia_private' and c.relkind in ('r','p')) as tables,
    (select count(*)::integer from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'gioia_private' and c.relkind in ('r','p')
        and c.relrowsecurity and c.relforcerowsecurity) as forced_rls,
    (select count(*)::integer from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'gioia_private') as functions,
    (select count(*)::integer from pg_catalog.pg_roles
      where rolname in ('app_runtime','gioia_mutator','gioia_migrator')) as roles,
    (select count(*)::integer from pg_catalog.pg_roles
      where rolname in ('app_runtime','gioia_mutator','gioia_migrator')
        and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole
          or rolinherit or rolreplication or rolbypassrls)) as unsafe_roles,
    (select count(*)::integer from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
      where (granted.rolname in ('app_runtime','gioia_mutator','gioia_migrator')
        and (member.rolname <> 'postgres' or not membership.admin_option
          or membership.inherit_option or membership.set_option))
        or member.rolname in ('app_runtime','gioia_mutator','gioia_migrator'))
      as unsafe_role_memberships,
    (select count(*)::integer from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p')) as public_tables,
    (select count(*)::integer from gioia_private.service_categories) as categories,
    (select count(*)::integer from gioia_private.services) as services,
    (select count(*)::integer from gioia_private.service_variants) as variants,
    (select count(*)::integer from gioia_private.business_hours) as hours,
    (select count(*)::integer from gioia_private.booking_policy) as policies,
    (select count(*)::integer from auth.users) as auth_users,
    (select count(*)::integer from auth.identities) as auth_identities,
    (select count(*)::integer from auth.sessions) as auth_sessions,
    (select count(*)::integer from auth.refresh_tokens) as refresh_tokens,
    (select count(*)::integer from auth.audit_log_entries) as auth_audit_rows,
    ((select count(*) from auth.mfa_factors)
      + (select count(*) from auth.mfa_challenges)
      + (select count(*) from auth.mfa_amr_claims)
      + (select count(*) from auth.one_time_tokens)
      + (select count(*) from auth.flow_state)
      + (select count(*) from auth.sso_providers)
      + (select count(*) from auth.sso_domains)
      + (select count(*) from auth.saml_providers)
      + (select count(*) from auth.saml_relay_states)
      + (select count(*) from auth.oauth_clients)
      + (select count(*) from auth.oauth_authorizations)
      + (select count(*) from auth.oauth_consents)
      + (select count(*) from auth.oauth_client_states)
      + (select count(*) from auth.custom_oauth_providers)
      + (select count(*) from auth.webauthn_credentials)
      + (select count(*) from auth.webauthn_challenges))::integer
      as auth_aux_rows,
    ((select count(*) from storage.buckets)
      + (select count(*) from storage.objects)
      + (select count(*) from storage.s3_multipart_uploads)
      + (select count(*) from storage.s3_multipart_uploads_parts)
      + (select count(*) from storage.buckets_analytics)
      + (select count(*) from storage.buckets_vectors)
      + (select count(*) from storage.vector_indexes))::integer as storage_rows,
    (select count(*)::integer from gioia_private.owner_accounts) as owners,
    (select count(*)::integer from gioia_private.owner_sessions) as owner_sessions,
    ((select count(*) from gioia_private.command_requests)
      + (select count(*) from gioia_private.schedule_day_locks)
      + (select count(*) from gioia_private.vacations)
      + (select count(*) from gioia_private.schedule_entries)
      + (select count(*) from gioia_private.newsletter_subscribers)
      + (select count(*) from gioia_private.email_outbox)
      + (select count(*) from gioia_private.email_webhook_events)
      + (select count(*) from gioia_private.domain_change_log)
      + (select count(*) from gioia_private.migration_runs)
      + (select count(*) from gioia_private.migration_records)
      + (select count(*) from gioia_private.migration_quarantine))::integer
      as operational_rows
`;

export const GREENFIELD_OWNER_PROVISION_SQL = Object.freeze([
  `insert into auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    confirmation_token,recovery_token,email_change_token_new,email_change,
    raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',$1::uuid,'authenticated',
    'authenticated',$2::text,
    extensions.crypt($3::text,extensions.gen_salt('bf',10)),
    statement_timestamp(),'','','','',
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
    false,statement_timestamp(),statement_timestamp()
  )`,
  `insert into auth.identities (
    id,provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at
  ) values (
    $1::uuid,$2::uuid::text,$2::uuid,
    pg_catalog.jsonb_build_object('sub',$2::uuid::text,'email',$3::text,
      'email_verified',true,'phone_verified',false),
    'email',statement_timestamp(),statement_timestamp(),statement_timestamp()
  )`,
  `insert into gioia_private.owner_accounts (user_id) values ($1::uuid)`,
]);
