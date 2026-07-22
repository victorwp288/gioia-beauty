export const GREENFIELD_CLEANUP_ISOLATION_SQL =
  "set transaction isolation level serializable";
export const GREENFIELD_RESIDUE_SQL = `
  with expected_entries(
    note, local_date, source, client_name, client_email, client_phone, created_by
  ) as (values
    (($1::text[])[1], ($2::date[])[1], 'public',
      'Synthetic Concurrency', 'distinct-key-race@example.test', '+390000000000', null::uuid),
    (($1::text[])[2], ($2::date[])[2], 'public',
      'Synthetic Concurrency', 'identical-key-race@example.test', '+390000000000', null::uuid),
    (($1::text[])[3], ($2::date[])[3], 'public',
      'Synthetic Concurrency', 'booking-vacation-race@example.test', '+390000000000', null::uuid),
    (($1::text[])[4], ($2::date[])[4], 'admin', 'Synthetic Swap A',
      'swap-a@example.test', null, $6::uuid),
    (($1::text[])[5], ($2::date[])[5], 'admin', 'Synthetic Swap B',
      'swap-b@example.test', null, $6::uuid)
  ), known_entries as (
    select entry.id
    from gioia_private.schedule_entries entry
    join expected_entries expected
      on expected.note = entry.client_note
      and expected.local_date = entry.local_date
      and expected.source = entry.source
      and expected.client_name = entry.client_name
      and expected.client_email = entry.client_email::text
      and expected.client_phone is not distinct from entry.client_phone
      and expected.created_by is not distinct from entry.created_by
    where entry.kind = 'appointment' and entry.status = 'confirmed'
      and entry.start_minutes = 600 and entry.service_id = $11
      and entry.variant_id = $12 and entry.version = 1
      and entry.internal_note is null and entry.cancelled_at is null
      and entry.legacy_firestore_id is null and entry.imported_at is null
  ), known_vacations as (
    select id from gioia_private.vacations
    where reason = $3 and start_date = ($2::date[])[3]
      and end_date = ($2::date[])[3] and status = 'active'
      and source = 'admin' and created_by = $6::uuid and version = 1
      and legacy_firestore_id is null and imported_at is null
      and cancelled_at is null and cancelled_by is null
  ), expected_abuse_policies(
    action, scope_kind, window_seconds, retention_seconds
  ) as (values
    ('owner_login', 'network', 900, 86400),
    ('owner_login', 'account', 900, 86400)
  ), known_abuse_buckets as (
    select bucket.action, bucket.scope_kind, bucket.hmac_key_id,
      bucket.scope_hash, bucket.bucket_start
    from gioia_private.public_abuse_buckets bucket
    join expected_abuse_policies expected
      on expected.action = bucket.action
      and expected.scope_kind = bucket.scope_kind
    join gioia_private.public_abuse_policies policy
      on policy.action = expected.action
      and policy.scope_kind = expected.scope_kind
      and policy.window_seconds = expected.window_seconds
      and policy.retention_seconds = expected.retention_seconds
    where bucket.hmac_key_id = 'public_v1'
      and octet_length(bucket.scope_hash) = 32
      and bucket.request_count = 1
      and bucket.bucket_start = pg_catalog.to_timestamp(
        pg_catalog.floor(
          extract(epoch from bucket.bucket_start) / expected.window_seconds
        ) * expected.window_seconds
      )
      and bucket.bucket_end = bucket.bucket_start
        + pg_catalog.make_interval(secs => expected.window_seconds)
      and bucket.expires_at = bucket.bucket_start
        + pg_catalog.make_interval(secs => expected.retention_seconds)
      and bucket.created_at = bucket.updated_at
      and bucket.created_at >= bucket.bucket_start
      and bucket.created_at < bucket.bucket_end
  ), known_aggregates as (
    select id from known_entries union all select id from known_vacations
  ), known_mfa_amr_claims as (
    select claim.id
    from auth.mfa_amr_claims claim
    join auth.sessions auth_session on auth_session.id = claim.session_id
    where auth_session.user_id = $8::uuid
      and claim.authentication_method = 'password'
      and claim.created_at <= claim.updated_at
  )
  select
    (select count(*)::integer from gioia_private.command_requests) as commands,
    (select count(distinct idempotency_key)::integer
      from gioia_private.command_requests) as distinct_command_keys,
    (select count(*)::integer from gioia_private.command_requests
      where state = 'completed') as completed_commands,
    (select count(*)::integer from gioia_private.command_requests
      where state = 'failed') as failed_commands,
    (select count(*)::integer from gioia_private.command_requests
      where idempotency_key like 'race-distinct-%' and state = 'completed')
      as distinct_completed_commands,
    (select count(*)::integer from gioia_private.command_requests
      where idempotency_key in (
        'race-booking-vacation-book','race-booking-vacation-close'
      ) and state = 'completed') as booking_vacation_completed_commands,
    (select count(*)::integer from gioia_private.command_requests command
      where command.idempotency_key <> all($4::text[])
        or command.operation <> case
          when command.idempotency_key like 'race-distinct-%'
            or command.idempotency_key in (
              'race-identical-key','race-booking-vacation-book'
            ) then 'public_booking'
          when command.idempotency_key = 'race-booking-vacation-close'
            then 'owner_create_vacation'
          when command.idempotency_key like 'race-swap-create-%'
            then 'owner_create_appointment'
          when command.idempotency_key like 'race-swap-reschedule-%'
            then 'owner_reschedule_appointment'
          else '' end
        or command.state not in ('completed','failed')
        or (command.idempotency_key in (
          'race-identical-key','race-swap-create-a','race-swap-create-b'
        ) and command.state is distinct from 'completed')
        or (command.idempotency_key like 'race-swap-reschedule-%'
          and command.state is distinct from 'failed')
        or (command.state = 'completed' and (
          command.resource_id is null or command.resource_kind is null
          or not (
            (command.idempotency_key like 'race-distinct-%'
              and command.resource_kind = 'schedule_entry'
              and exists (select 1 from gioia_private.schedule_entries entry
                where entry.id = command.resource_id
                  and entry.client_note = 'synthetic-distinct-key-race'))
            or (command.idempotency_key = 'race-identical-key'
              and command.resource_kind = 'schedule_entry'
              and exists (select 1 from gioia_private.schedule_entries entry
                where entry.id = command.resource_id
                  and entry.client_note = 'synthetic-identical-key-race'))
            or (command.idempotency_key = 'race-booking-vacation-book'
              and command.resource_kind = 'schedule_entry'
              and exists (select 1 from gioia_private.schedule_entries entry
                where entry.id = command.resource_id
                  and entry.client_note = 'synthetic-booking-vacation-race'))
            or (command.idempotency_key = 'race-booking-vacation-close'
              and command.resource_kind = 'vacation'
              and command.resource_id in (select id from known_vacations))
            or (command.idempotency_key = 'race-swap-create-a'
              and command.resource_kind = 'schedule_entry'
              and exists (select 1 from gioia_private.schedule_entries entry
                where entry.id = command.resource_id
                  and entry.client_note = 'synthetic-reschedule-swap-a'))
            or (command.idempotency_key = 'race-swap-create-b'
              and command.resource_kind = 'schedule_entry'
              and exists (select 1 from gioia_private.schedule_entries entry
                where entry.id = command.resource_id
                  and entry.client_note = 'synthetic-reschedule-swap-b'))
          )))
        or (command.state = 'failed'
          and (command.resource_id is not null or command.resource_kind is not null)))
      as unknown_commands,
    (select count(*)::integer from gioia_private.schedule_entries) as entries,
    (select count(*)::integer from gioia_private.schedule_entries
      where id not in (select id from known_entries)) as unknown_entries,
    (select count(*)::integer from gioia_private.vacations) as vacations,
    (select count(*)::integer from gioia_private.vacations
      where id not in (select id from known_vacations)) as unknown_vacations,
    (select count(*)::integer from gioia_private.email_outbox) as outbox,
    (select count(*)::integer
      from gioia_private.email_outbox outbox
      left join gioia_private.schedule_entries entry
        on entry.id = outbox.aggregate_id
      cross join gioia_private.booking_policy policy
      where outbox.aggregate_id not in (select id from known_entries)
        or outbox.aggregate_kind <> 'schedule_entry'
        or outbox.aggregate_version <> 1 or outbox.status <> 'pending'
        or outbox.attempt_count <> 0
        or (select count(*) from gioia_private.email_outbox peer
          where peer.aggregate_id = outbox.aggregate_id
            and peer.recipient_kind = 'customer') <> 1
        or (select count(*) from gioia_private.email_outbox peer
          where peer.aggregate_id = outbox.aggregate_id
            and peer.recipient_kind = 'owner') <> 1
        or not (
          (outbox.recipient_kind = 'customer'
            and outbox.recipient_address = entry.client_email
            and outbox.template_kind = 'booking_customer')
          or (outbox.recipient_kind = 'owner'
            and outbox.recipient_address = policy.admin_notification_email
            and outbox.template_kind = 'booking_owner')
        )) as unknown_outbox,
    (select count(*)::integer from gioia_private.domain_change_log) as changes,
    (select count(distinct aggregate_id)::integer
      from gioia_private.domain_change_log) as distinct_change_aggregates,
    (select count(*)::integer
      from gioia_private.domain_change_log change
      where change.aggregate_id not in (select id from known_aggregates)
        or change.aggregate_version <> 1 or change.change_kind <> 'create'
        or change.schema_version <> 1
        or not exists (
          select 1 from gioia_private.command_requests command
          where command.id = change.command_request_id
            and command.state = 'completed'
            and command.resource_id = change.aggregate_id
        )
        or (
          not exists (
            select 1 from gioia_private.schedule_entries entry
            where entry.id = change.aggregate_id
              and change.aggregate_kind = 'schedule_entry'
              and change.source = entry.source
              and ((entry.source = 'public' and change.actor_user_id is null)
                or (entry.source = 'admin'
                  and change.actor_user_id = $6::uuid))
          ) and not (
            change.aggregate_id in (select id from known_vacations)
            and change.aggregate_kind = 'vacation'
            and change.source = 'admin' and change.actor_user_id = $6::uuid
          )
        )) as unknown_changes,
    (select count(*)::integer from gioia_private.schedule_day_locks) as locks,
    (select count(*)::integer from gioia_private.schedule_day_locks
      where local_date <> all($2::date[])) as unknown_locks,
    (select count(*)::integer from gioia_private.owner_accounts) as owners,
    (select count(*)::integer from gioia_private.owner_accounts owner
      where owner.user_id <> all($5::uuid[]) or owner.role <> 'owner'
        or not owner.enabled or owner.version <> 1) as unknown_owners,
    (select count(*)::integer from gioia_private.owner_sessions) as owner_sessions,
    (select count(*)::integer from gioia_private.owner_sessions session
      where not (
        (session.user_id = $6::uuid and session.session_id = $7::uuid
          and session.revoked_at is null
          and session.expires_at > statement_timestamp())
        or (session.user_id = $8::uuid and (
          session.revoked_at is not null
          or (session.revoked_at is null
            and session.expires_at > statement_timestamp()
            and exists (select 1 from auth.sessions auth_session
              where auth_session.id = session.session_id
                and auth_session.user_id = session.user_id))
        ))
      )) as unknown_owner_sessions,
    (select count(*)::integer from gioia_private.owner_sessions
      where user_id = $6::uuid and session_id = $7::uuid
        and revoked_at is null) as concurrency_session,
    (select count(*)::integer from gioia_private.owner_sessions
      where user_id = $8::uuid and revoked_at is not null) as revoked_route_session,
    (select count(*)::integer from auth.users) as auth_users,
    (select count(*)::integer from auth.users user_account
      where not (
        (user_account.id = $8::uuid
          and user_account.email is not distinct from $10
          and user_account.encrypted_password is not null)
        or (user_account.id = $6::uuid
          and user_account.email is not distinct from 'owner@concurrency.test'
          and user_account.encrypted_password is null)
      ) or user_account.aud is distinct from 'authenticated'
        or user_account.role is distinct from 'authenticated'
        or coalesce(user_account.is_anonymous, false)
        or user_account.raw_app_meta_data ->> 'provider'
          is distinct from 'email'
        or user_account.raw_app_meta_data -> 'providers'
          is distinct from '["email"]'::jsonb)
      as unknown_auth_users,
    (select count(*)::integer from auth.identities) as identities,
    (select count(*)::integer from auth.identities identity
      where identity.id is distinct from $9::uuid
        or identity.user_id is distinct from $8::uuid
        or identity.provider is distinct from 'email'
        or identity.provider_id is distinct from $8::uuid::text
        or identity.identity_data ->> 'sub' is distinct from $8::uuid::text
        or identity.identity_data ->> 'email' is distinct from $10)
      as unknown_identities,
    (select count(*)::integer from auth.sessions) as auth_sessions,
    (select count(*)::integer from auth.sessions auth_session
      where auth_session.user_id is distinct from $8::uuid)
      as unknown_auth_sessions,
    (select count(*)::integer from auth.refresh_tokens) as refresh_tokens,
    (select count(*)::integer from auth.refresh_tokens refresh_token
      where refresh_token.user_id is distinct from $8::uuid::text
        or refresh_token.session_id is null
        or not exists (select 1 from auth.sessions auth_session
          where auth_session.id = refresh_token.session_id
            and auth_session.user_id = $8::uuid)) as unknown_refresh_tokens,
    (select count(*)::integer from auth.audit_log_entries) as auth_audit_rows,
    (select count(*)::integer from auth.audit_log_entries
      where payload is null
        or (coalesce(payload::text, '') not like ('%' || $8::uuid::text || '%')
          and coalesce(payload::text, '') not like ('%' || $10::text || '%')))
      as unknown_auth_audit_rows,
    (select count(*)::integer from gioia_private.public_abuse_buckets)
      as abuse_buckets,
    (select count(*)::integer from known_abuse_buckets
      where scope_kind = 'network') as owner_login_network_buckets,
    (select count(*)::integer from known_abuse_buckets
      where scope_kind = 'account') as owner_login_account_buckets,
    (select count(*)::integer from gioia_private.public_abuse_buckets bucket
      where not exists (
        select 1 from known_abuse_buckets known
        where known.action = bucket.action
          and known.scope_kind = bucket.scope_kind
          and known.hmac_key_id = bucket.hmac_key_id
          and known.scope_hash = bucket.scope_hash
          and known.bucket_start = bucket.bucket_start
      )) as unknown_abuse_buckets,
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
    (select count(*)::integer from known_mfa_amr_claims)
      as known_mfa_amr_claims,
    ((select count(*) from auth.mfa_factors)
      + (select count(*) from auth.mfa_challenges)
      + (select count(*) from auth.mfa_amr_claims claim
        where claim.id not in (select id from known_mfa_amr_claims))
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
      as unknown_auth_aux_rows,
    ((select count(*) from storage.buckets)
      + (select count(*) from storage.objects)
      + (select count(*) from storage.s3_multipart_uploads)
      + (select count(*) from storage.s3_multipart_uploads_parts)
      + (select count(*) from storage.buckets_analytics)
      + (select count(*) from storage.buckets_vectors)
      + (select count(*) from storage.vector_indexes))::integer as storage_rows,
    ((select count(*) from gioia_private.newsletter_subscribers)
      + (select count(*) from gioia_private.email_webhook_events)
      + (select count(*) from gioia_private.migration_runs)
      + (select count(*) from gioia_private.migration_records)
      + (select count(*) from gioia_private.migration_quarantine)
      + (select count(*) from gioia_private.privacy_holds)
      + (select count(*) from gioia_private.privacy_operation_evidence)
      + (select count(*) from gioia_private.privacy_policy_decisions)
      + (select count(*) from gioia_private.privacy_policy_versions)
      + (select count(*) from gioia_private.privacy_request_inventory)
      + (select count(*) from gioia_private.privacy_scrub_plan_items)
      + (select count(*) from gioia_private.privacy_subject_requests))::integer
      as unrelated_rows
`;

export const GREENFIELD_CLEANUP_SQL = Object.freeze([
  `delete from auth.audit_log_entries
    where payload::text like ('%' || $1::uuid::text || '%')
      or payload::text like ('%' || $2::text || '%')`,
  `delete from gioia_private.public_abuse_buckets bucket
    using gioia_private.public_abuse_policies policy
    where policy.action = bucket.action
      and policy.scope_kind = bucket.scope_kind
      and bucket.action = 'owner_login'
      and bucket.scope_kind in ('network', 'account')
      and policy.window_seconds = 900
      and policy.retention_seconds = 86400
      and bucket.hmac_key_id = 'public_v1'
      and octet_length(bucket.scope_hash) = 32
      and bucket.request_count = 1
      and bucket.bucket_start = pg_catalog.to_timestamp(
        pg_catalog.floor(extract(epoch from bucket.bucket_start) / 900) * 900
      )
      and bucket.bucket_end = bucket.bucket_start
        + pg_catalog.make_interval(secs => 900)
      and bucket.expires_at = bucket.bucket_start
        + pg_catalog.make_interval(secs => 86400)
      and bucket.created_at = bucket.updated_at
      and bucket.created_at >= bucket.bucket_start
      and bucket.created_at < bucket.bucket_end`,
  `delete from gioia_private.email_outbox where aggregate_id in (
    select id from gioia_private.schedule_entries
    where client_note = any($1::text[]) and local_date = any($2::date[])
  )`,
  `delete from gioia_private.domain_change_log where aggregate_id in (
    select id from gioia_private.schedule_entries
    where client_note = any($1::text[]) and local_date = any($2::date[])
    union all select id from gioia_private.vacations
    where reason = $3 and start_date = ($2::date[])[3]
      and end_date = ($2::date[])[3]
  )`,
  `delete from gioia_private.command_requests
    where idempotency_key = any($1::text[])`,
  `delete from gioia_private.schedule_entries
    where client_note = any($1::text[]) and local_date = any($2::date[])`,
  `delete from gioia_private.vacations
    where reason = $1 and start_date = $2::date and end_date = $2::date`,
  `delete from gioia_private.schedule_day_locks
    where local_date = any($1::date[])`,
  `delete from gioia_private.owner_sessions where user_id = any($1::uuid[])`,
  `delete from gioia_private.owner_accounts where user_id = any($1::uuid[])`,
  `delete from auth.users where id = any($1::uuid[])`,
]);
