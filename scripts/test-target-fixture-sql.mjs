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
export const GREENFIELD_REFERENCE_TABLE_NAMES = Object.freeze([
  "booking_policy",
  "business_hours",
  "cutover_write_control",
  "email_dead_letter_monitor_state",
  "public_abuse_policies",
  "service_categories",
  "service_variants",
  "services",
]);
export const GREENFIELD_OPERATIONAL_TABLE_NAMES = Object.freeze([
  "command_requests",
  "cutover_canary_events",
  "cutover_canary_grants",
  "cutover_canary_runs",
  "cutover_transition_log",
  "domain_change_log",
  "email_dead_letter_events",
  "email_outbox",
  "email_webhook_events",
  "migration_quarantine",
  "migration_records",
  "migration_runs",
  "newsletter_action_signing_keys",
  "newsletter_action_tokens",
  "newsletter_consent_artifacts",
  "newsletter_consent_cycles",
  "newsletter_consent_events",
  "newsletter_subscribers",
  "owner_accounts",
  "owner_sessions",
  "privacy_holds",
  "privacy_operation_evidence",
  "privacy_policy_decisions",
  "privacy_policy_versions",
  "privacy_request_inventory",
  "privacy_scrub_plan_items",
  "privacy_subject_requests",
  "public_abuse_buckets",
  "schedule_day_locks",
  "schedule_entries",
  "vacations",
]);
export const GREENFIELD_EXPECTED_PRIVATE_TABLE_NAMES = Object.freeze(
  [
    ...GREENFIELD_REFERENCE_TABLE_NAMES,
    ...GREENFIELD_OPERATIONAL_TABLE_NAMES,
  ].sort(),
);
export const GREENFIELD_EXPECTED_PRIVATE_FUNCTION_NAMES = Object.freeze(
  `ack_email_dead_letter_alert_batch apply_legacy_quarantine_import
  apply_legacy_schedule_import apply_legacy_subscriber_import
  apply_legacy_vacation_import assert_enabled_owner
  assert_enabled_owner_account assert_interval_open assert_owner_slot_policy
  assert_public_slot_policy assert_schedule_date_open assert_vacation_span_clear
  authenticated_owner_session_id authorize_cutover_write
  assert_privacy_policy_approved
  authorize_owner_session begin_command begin_cutover_canary_run
  begin_cutover_write_freeze begin_email_outbox_provider_attempt
  begin_legacy_migration_import canonicalize_newsletter_action_token_times
  claim_email_dead_letter_alert_batch claim_email_outbox complete_command
  complete_cutover_unfreeze complete_email_outbox_failure
  complete_email_outbox_pre_provider_failure complete_email_outbox_success
  complete_legacy_migration_import confirm_public_newsletter
  consume_public_abuse_bucket count_privacy_owner_auth_dry_run
  count_schedule_as_owner create_public_booking
  enforce_approved_privacy_decision_immutability
  enforce_approved_privacy_policy_immutability enforce_command_request_transition
  enforce_email_outbox_transition
  enforce_email_webhook_event_transition enforce_migration_quarantine_transition
  enforce_migration_run_transition enforce_newsletter_action_token_transition
  enforce_newsletter_consent_cycle_binding
  enforce_newsletter_subscriber_transition enforce_schedule_entry_transition
  enforce_vacation_transition enqueue_schedule_emails
  enter_cutover_owner_reconcile export_schedule_as_owner fail_command
  get_cutover_write_state get_public_availability
  inventory_privacy_subject_dry_run issue_cutover_canary_grant
  list_email_outbox_as_owner list_newsletter_subscribers_as_owner
  list_schedule_as_owner list_vacations_as_owner lock_schedule_dates
  maintain_email_webhook_replay_lifecycle owner_cancel_schedule_entry
  owner_cancel_vacation owner_create_appointment owner_create_block
  owner_create_vacation owner_reschedule_appointment owner_reschedule_block
  owner_scope_hash owner_set_appointment_status owner_unsubscribe_subscriber
  owner_update_appointment_details owner_update_block_details
  owner_update_vacation plan_privacy_scrub_dry_run
  prepare_legacy_migration_import_record
  process_verified_email_webhook purge_expired_public_abuse_buckets
  reconcile_cutover_canary_run record_domain_change
  record_email_dead_letter_event replay_pending_verified_email_webhooks
  resolve_active_variant retry_email_outbox_as_owner
  revoke_cutover_canary_grant revoke_owner_session rome_today
  set_updated_at_and_version start_owner_session subscribe_public_newsletter
  suppress_cutover_canary_outbox unsubscribe_public_newsletter`
    .split(/\s+/u)
    .sort(),
);

const operationalRowCountSql = GREENFIELD_OPERATIONAL_TABLE_NAMES.map(
  (table) => `(select count(*) from gioia_private.${table})`,
).join("\n      + ");

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
      where rolname in (
        'app_runtime','gioia_mutator','gioia_migrator'
      )) as roles,
    (select count(*)::integer from pg_catalog.pg_roles
      where rolname in (
        'app_runtime','gioia_mutator','gioia_migrator'
      )
        and ((rolname='app_runtime' and not rolcanlogin) or
          (rolname<>'app_runtime' and rolcanlogin) or rolsuper or rolcreatedb or rolcreaterole
          or rolinherit or rolreplication or rolbypassrls)) as unsafe_roles,
    (select count(*)::integer from pg_catalog.pg_authid
      where (rolname='app_runtime' and rolpassword not like 'SCRAM-SHA-256$%')
        or (rolname in ('gioia_mutator','gioia_migrator') and rolpassword is not null))
      as unsafe_role_credentials,
    ((select count(*) from pg_catalog.pg_auth_members membership
        join pg_catalog.pg_roles granted on granted.oid = membership.roleid
        join pg_catalog.pg_roles member on member.oid = membership.member
        join pg_catalog.pg_roles grantor on grantor.oid = membership.grantor
        where (granted.rolname in (
            'app_runtime','gioia_mutator','gioia_migrator'
          ) or member.rolname in (
            'app_runtime','gioia_mutator','gioia_migrator'
          )) and not (
            (granted.rolname in (
                'app_runtime','gioia_mutator','gioia_migrator'
              )
              and member.rolname = 'postgres'
              and grantor.rolname = 'supabase_admin'
              and membership.admin_option
              and not membership.inherit_option
              and not membership.set_option)
          ))
      + abs((select count(*) from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles granted on granted.oid = membership.roleid
          join pg_catalog.pg_roles member on member.oid = membership.member
          where granted.rolname in (
              'app_runtime','gioia_mutator','gioia_migrator'
            ) or member.rolname in (
              'app_runtime','gioia_mutator','gioia_migrator'
            )) - 3))::integer
      as unsafe_role_memberships,
    (select count(*)::integer from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p')) as public_tables,
    (select count(*)::integer from gioia_private.service_categories) as categories,
    (select count(*)::integer from gioia_private.services) as services,
    (select count(*)::integer from gioia_private.service_variants) as variants,
    (select count(*)::integer from gioia_private.business_hours) as hours,
    (select count(*)::integer from gioia_private.booking_policy) as policies,
    (select count(*)::integer from gioia_private.public_abuse_policies)
      as abuse_policies,
    (select count(*)::integer from gioia_private.cutover_write_control)
      as cutover_controls,
    (select count(*)::integer from gioia_private.email_dead_letter_monitor_state)
      as dead_letter_monitor_states,
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
    (${operationalRowCountSql})::integer
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
