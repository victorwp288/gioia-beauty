begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table gioia_private.command_requests
  add constraint command_requests_principal_algorithm_current
    check (principal_scope_algorithm_version = 1),
  add constraint command_requests_fingerprint_algorithm_current
    check (request_fingerprint_algorithm_version = 1),
  add constraint command_requests_idempotency_key_format check (
    octet_length(idempotency_key) between 8 and 255
    and idempotency_key ~ '^[A-Za-z0-9._:-]{8,255}$'
  ),
  add constraint command_requests_response_snapshot_safe check (
    response_snapshot is null
    or case when jsonb_typeof(response_snapshot) = 'object' then (
      octet_length(response_snapshot::text) between 2 and 1024
      and (response_snapshot ? 'code')
      and response_snapshot - 'code' - 'resource_id' = '{}'::jsonb
      and jsonb_typeof(response_snapshot -> 'code') = 'string'
      and (response_snapshot ->> 'code') ~ '^[A-Z][A-Z0-9_]{1,63}$'
      and ((resource_id is null and not (response_snapshot ? 'resource_id'))
        or (resource_id is not null
          and jsonb_typeof(response_snapshot -> 'resource_id') = 'string'
          and (response_snapshot ->> 'resource_id') = resource_id::text))
    ) else false end
  ),
  add constraint command_requests_completion_consistent check (
    (state = 'in_progress' and completed_at is null and http_status is null
      and error_code is null and response_snapshot is null
      and resource_kind is null and resource_id is null)
    or (state = 'completed' and completed_at is not null and completed_at >= created_at
      and http_status between 200 and 299 and error_code is null
      and response_snapshot is not null and resource_kind is not null and resource_id is not null)
    or (state = 'failed' and completed_at is not null and completed_at >= created_at
      and http_status between 400 and 599 and error_code is not null
      and response_snapshot is not null and (response_snapshot ->> 'code') = error_code)
  );

create function gioia_private.enforce_command_request_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.id, old.operation, old.principal_scope_hash,
    old.principal_scope_algorithm_version, old.idempotency_key,
    old.request_fingerprint, old.request_fingerprint_algorithm_version,
    old.expires_at, old.created_at
  ) is distinct from row(
    new.id, new.operation, new.principal_scope_hash,
    new.principal_scope_algorithm_version, new.idempotency_key,
    new.request_fingerprint, new.request_fingerprint_algorithm_version,
    new.expires_at, new.created_at
  ) then
    raise exception using errcode = '23514', message = 'Command request identity is immutable';
  end if;

  if old.state in ('completed', 'failed') then
    raise exception using errcode = '23514', message = 'Completed command requests are immutable';
  end if;

  if new.state not in ('in_progress', 'completed', 'failed') then
    raise exception using errcode = '23514', message = 'Invalid command request transition';
  end if;

  return new;
end;
$$;

create function gioia_private.enforce_newsletter_subscriber_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.id, old.schema_version, old.email, old.source,
    old.legacy_firestore_id, old.timestamp_provenance,
    old.imported_at, old.created_at
  ) is distinct from row(
    new.id, new.schema_version, new.email, new.source,
    new.legacy_firestore_id, new.timestamp_provenance,
    new.imported_at, new.created_at
  ) then
    raise exception using errcode = '23514', message = 'Subscriber identity and provenance are immutable';
  end if;

  if old.status <> new.status and not (
    (old.status = 'legacy_unverified' and new.status in ('pending', 'unsubscribed'))
    or (old.status = 'pending' and new.status in (
      'active', 'unsubscribed', 'bounced', 'complained'
    ))
    or (old.status = 'active' and new.status in ('unsubscribed', 'bounced', 'complained'))
    or (old.status = 'unsubscribed' and new.status = 'pending')
    or (old.status = 'bounced' and new.status in ('pending', 'unsubscribed', 'complained'))
  ) then
    raise exception using errcode = '23514', message = 'Invalid subscriber status transition';
  end if;

  return new;
end;
$$;

create function gioia_private.enforce_email_outbox_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.id, old.aggregate_kind, old.aggregate_id, old.aggregate_version,
    old.recipient_kind, old.recipient_address, old.template_kind,
    old.template_data, old.idempotency_key, old.created_at
  ) is distinct from row(
    new.id, new.aggregate_kind, new.aggregate_id, new.aggregate_version,
    new.recipient_kind, new.recipient_address, new.template_kind,
    new.template_data, new.idempotency_key, new.created_at
  ) then
    raise exception using errcode = '23514', message = 'Outbox recipient and template snapshots are immutable';
  end if;

  if old.provider_message_id is not null
    and old.provider_message_id is distinct from new.provider_message_id then
    raise exception using errcode = '23514', message = 'Provider message identity is immutable';
  end if;

  if old.sent_at is not null and old.sent_at is distinct from new.sent_at then
    raise exception using errcode = '23514', message = 'Outbox sent timestamp is immutable';
  end if;

  if new.attempt_count < old.attempt_count
    or new.attempt_count > old.attempt_count + 1 then
    raise exception using errcode = '23514', message = 'Outbox attempt count must advance monotonically';
  end if;

  if old.status <> new.status and not (
    (old.status = 'pending' and new.status = 'sending')
    or (old.status = 'sending' and new.status in (
      'sent', 'failed', 'dead_letter', 'bounced', 'complained'
    ))
    or (old.status = 'failed' and new.status in (
      'sending', 'sent', 'dead_letter', 'bounced', 'complained'
    ))
    or (old.status = 'sent' and new.status in ('bounced', 'complained'))
    or (old.status = 'bounced' and new.status = 'complained')
  ) then
    raise exception using errcode = '23514', message = 'Invalid outbox status transition';
  end if;

  return new;
end;
$$;

create function gioia_private.enforce_migration_run_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.id, old.run_kind, old.source_project_ref, old.dry_run,
    old.source_manifest_sha256, old.started_at
  ) is distinct from row(
    new.id, new.run_kind, new.source_project_ref, new.dry_run,
    new.source_manifest_sha256, new.started_at
  ) then
    raise exception using errcode = '23514', message = 'Migration run identity is immutable';
  end if;

  if old.status <> 'running' then
    raise exception using errcode = '23514', message = 'Completed migration runs are immutable';
  end if;

  return new;
end;
$$;

create function gioia_private.enforce_migration_quarantine_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.id, old.run_id, old.source_collection, old.source_record_id,
    old.ledger_disposition, old.reason_code, old.field_codes, old.created_at
  ) is distinct from row(
    new.id, new.run_id, new.source_collection, new.source_record_id,
    new.ledger_disposition, new.reason_code, new.field_codes, new.created_at
  ) then
    raise exception using errcode = '23514', message = 'Migration quarantine evidence is immutable';
  end if;

  if old.resolved_at is not null then
    raise exception using errcode = '23514', message = 'Resolved migration quarantine is immutable';
  end if;

  return new;
end;
$$;

revoke all on function gioia_private.enforce_command_request_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.enforce_newsletter_subscriber_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.enforce_email_outbox_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.enforce_migration_run_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_mutator;
revoke all on function gioia_private.enforce_migration_quarantine_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_mutator;
grant execute on function gioia_private.enforce_command_request_transition() to gioia_mutator;
grant execute on function gioia_private.enforce_newsletter_subscriber_transition() to gioia_mutator;
grant execute on function gioia_private.enforce_email_outbox_transition() to gioia_mutator;
grant execute on function gioia_private.enforce_migration_run_transition() to gioia_migrator;
grant execute on function gioia_private.enforce_migration_quarantine_transition() to gioia_migrator;

create trigger command_requests_state_guard
before update on gioia_private.command_requests
for each row execute function gioia_private.enforce_command_request_transition();
create trigger newsletter_subscribers_state_guard
before update on gioia_private.newsletter_subscribers
for each row execute function gioia_private.enforce_newsletter_subscriber_transition();
create trigger email_outbox_state_guard
before update on gioia_private.email_outbox
for each row execute function gioia_private.enforce_email_outbox_transition();
create trigger migration_runs_state_guard
before update on gioia_private.migration_runs
for each row execute function gioia_private.enforce_migration_run_transition();
create trigger migration_quarantine_state_guard
before update on gioia_private.migration_quarantine
for each row execute function gioia_private.enforce_migration_quarantine_transition();

commit;
