begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
grant gioia_migrator to postgres;
grant create on schema gioia_private to gioia_migrator;
grant select on table gioia_private.schedule_entries,
  gioia_private.newsletter_subscribers, gioia_private.email_outbox,
  gioia_private.email_webhook_events, gioia_private.command_requests to gioia_migrator;
create policy privacy_inventory_schedule_entries_migrator_select on gioia_private.schedule_entries for select to gioia_migrator using (true);
create policy privacy_inventory_subscribers_migrator_select on gioia_private.newsletter_subscribers for select to gioia_migrator using (true);
create policy privacy_inventory_outbox_migrator_select on gioia_private.email_outbox for select to gioia_migrator using (true);
create policy privacy_inventory_webhooks_migrator_select on gioia_private.email_webhook_events for select to gioia_migrator using (true);
create policy privacy_inventory_commands_migrator_select on gioia_private.command_requests for select to gioia_migrator using (true);
create function gioia_private.count_privacy_owner_auth_dry_run(
  p_normalized_email text, p_max_rows smallint
) returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from (
    select auth_user.id
    from auth.users as auth_user
    where p_normalized_email is not null
      and auth_user.email = p_normalized_email
    order by auth_user.id
    limit p_max_rows + 1
  ) as bounded_auth_users;
$$;
revoke all on function gioia_private.count_privacy_owner_auth_dry_run(text,smallint) from
  public, anon, authenticated, service_role, app_runtime, gioia_mutator;
grant execute on function gioia_private.count_privacy_owner_auth_dry_run(text,smallint)
  to gioia_migrator;
set local role gioia_migrator;
create function gioia_private.assert_privacy_policy_approved(
  p_policy_version text, p_environment text, p_target_id text
) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1
    from gioia_private.privacy_policy_versions as policy
    where policy.policy_version = p_policy_version
      and policy.environment = p_environment
      and policy.target_id = p_target_id
      and policy.status = 'approved'
      and policy.approved_at is not null
      and policy.approval_evidence_sha256 is not null
      and (
        select count(*) = 18 and bool_and(decision.status = 'approved')
        from gioia_private.privacy_policy_decisions as decision
        where decision.policy_version = policy.policy_version
      )
  ) then
    raise sqlstate 'PT503' using message = 'PRIVACY_POLICY_NOT_APPROVED';
  end if;
end;
$$;
create function gioia_private.enforce_approved_privacy_policy_immutability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'approved'
    and tg_op = 'UPDATE'
    and new.status = 'retired'
    and new.policy_version is not distinct from old.policy_version
    and new.environment is not distinct from old.environment
    and new.target_id is not distinct from old.target_id
    and new.artifact_sha256 is not distinct from old.artifact_sha256
    and new.approved_at is not distinct from old.approved_at
    and new.approval_evidence_sha256 is not distinct from old.approval_evidence_sha256
    and new.created_at is not distinct from old.created_at then
    return new;
  end if;
  if old.status in ('approved', 'retired') then
    raise sqlstate 'PT409' using message = 'PRIVACY_POLICY_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger privacy_policy_versions_immutable
before update or delete on gioia_private.privacy_policy_versions
for each row execute function gioia_private.enforce_approved_privacy_policy_immutability();
create function gioia_private.enforce_approved_privacy_decision_immutability()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_policy_version text;
begin
  if tg_op = 'INSERT' then
    v_policy_version := new.policy_version;
  else
    v_policy_version := old.policy_version;
  end if;
  if exists (
    select 1
    from gioia_private.privacy_policy_versions as policy
    where policy.policy_version = v_policy_version
      and policy.status in ('approved', 'retired')
  ) then
    raise sqlstate 'PT409' using message = 'PRIVACY_DECISION_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger privacy_policy_decisions_immutable
before insert or update or delete on gioia_private.privacy_policy_decisions
for each row execute function gioia_private.enforce_approved_privacy_decision_immutability();
create function gioia_private.inventory_privacy_subject_dry_run(
  p_case_id uuid, p_policy_version text, p_environment text, p_target_id text,
  p_request_kind text, p_normalized_email text, p_client_phone text,
  p_schedule_entry_id uuid, p_selector_manifest_sha256 bytea,
  p_identity_evidence_sha256 bytea, p_identity_verified_at timestamptz,
  p_max_rows_per_store smallint
)
returns table (store_name text, matched_rows integer, capped boolean)
language plpgsql
volatile
security definer
set search_path = ''
rows 8
as $$
declare
  v_selector_count smallint;
  v_total integer;
  v_artifact bytea;
begin
  v_selector_count := (p_normalized_email is not null)::integer
    + (p_client_phone is not null)::integer
    + (p_schedule_entry_id is not null)::integer;
  if p_case_id is null
    or p_request_kind is null
    or p_request_kind not in ('access', 'erasure')
    or v_selector_count not between 1 and 3
    or (p_normalized_email is not null and (
      p_normalized_email <> pg_catalog.lower(pg_catalog.btrim(p_normalized_email))
      or pg_catalog.length(p_normalized_email) not between 3 and 320))
    or (p_client_phone is not null and (
      p_client_phone <> pg_catalog.btrim(p_client_phone)
      or pg_catalog.length(p_client_phone) not between 1 and 40))
    or p_selector_manifest_sha256 is null
    or pg_catalog.octet_length(p_selector_manifest_sha256) <> 32
    or p_identity_evidence_sha256 is null
    or pg_catalog.octet_length(p_identity_evidence_sha256) <> 32
    or p_identity_verified_at is null
    or p_identity_verified_at > pg_catalog.statement_timestamp()
    or p_max_rows_per_store is null
    or p_max_rows_per_store not between 1 and 100 then
    raise sqlstate 'PT400' using message = 'PRIVACY_INVENTORY_INVALID';
  end if;
  perform gioia_private.assert_privacy_policy_approved(
    p_policy_version, p_environment, p_target_id
  );

  insert into gioia_private.privacy_subject_requests (
    case_id, policy_version, request_kind, selector_count,
    selector_manifest_sha256, identity_evidence_sha256, identity_verified_at
  ) values (
    p_case_id, p_policy_version, p_request_kind, v_selector_count,
    p_selector_manifest_sha256, p_identity_evidence_sha256,
    p_identity_verified_at
  );

  with matched_schedule as materialized (
    select entry.id
    from gioia_private.schedule_entries as entry
    where (p_schedule_entry_id is not null and entry.id = p_schedule_entry_id)
      or (p_normalized_email is not null
        and entry.client_email = p_normalized_email::extensions.citext)
      or (p_client_phone is not null and entry.client_phone = p_client_phone)
    order by entry.id
    limit p_max_rows_per_store + 1
  ), matched_subscriber as materialized (
    select subscriber.id
    from gioia_private.newsletter_subscribers as subscriber
    where p_normalized_email is not null
      and subscriber.email = p_normalized_email::extensions.citext
    order by subscriber.id
    limit p_max_rows_per_store + 1
  ), matched_outbox as materialized (
    select candidate.id, candidate.provider_message_id
    from (
      select outbox.id, outbox.provider_message_id
      from gioia_private.email_outbox as outbox
      where p_normalized_email is not null
        and outbox.recipient_address = p_normalized_email::extensions.citext
      union
      select outbox.id, outbox.provider_message_id
      from gioia_private.email_outbox as outbox
      where outbox.aggregate_kind = 'schedule_entry'
        and outbox.aggregate_id in (select id from matched_schedule)
      union
      select outbox.id, outbox.provider_message_id
      from gioia_private.email_outbox as outbox
      where outbox.aggregate_kind = 'subscriber'
        and outbox.aggregate_id in (select id from matched_subscriber)
    ) as candidate
    order by candidate.id
    limit p_max_rows_per_store + 1
  ), inventory as (
    select 'schedule_entries'::text as store_name,
      (select count(*)::integer from matched_schedule) as found
    union all select 'newsletter_subscribers',
      (select count(*)::integer from matched_subscriber)
    union all select 'email_outbox',
      (select count(*)::integer from matched_outbox)
    union all select 'email_webhook_events', (
      select count(*)::integer from (
        select webhook.provider_event_id
        from gioia_private.email_webhook_events as webhook
        where webhook.provider_message_id in (
          select provider_message_id from matched_outbox
          where provider_message_id is not null
        )
        order by webhook.provider_event_id
        limit p_max_rows_per_store + 1
      ) as bounded_webhooks)
    union all select 'command_requests', (
      select count(*)::integer from (
        select command.id
        from gioia_private.command_requests as command
        where (command.resource_kind = 'schedule_entry'
            and command.resource_id in (select id from matched_schedule))
          or (command.resource_kind = 'subscriber'
            and command.resource_id in (select id from matched_subscriber))
        order by command.id
        limit p_max_rows_per_store + 1
      ) as bounded_commands)
    union all select 'domain_change_log', (
      select count(*)::integer from (
        select change.sequence_id
        from gioia_private.domain_change_log as change
        where (change.aggregate_kind = 'schedule_entry'
            and change.aggregate_id in (select id from matched_schedule))
          or (change.aggregate_kind = 'subscriber'
            and change.aggregate_id in (select id from matched_subscriber))
        order by change.sequence_id
        limit p_max_rows_per_store + 1
      ) as bounded_changes)
    union all select 'migration_evidence', (
      select count(*)::integer from (
        select record.run_id, record.source_collection, record.source_record_id
        from gioia_private.migration_records as record
        where (record.target_kind = 'schedule_entry'
            and record.target_id in (select id from matched_schedule))
          or (record.target_kind = 'subscriber'
            and record.target_id in (select id from matched_subscriber))
        order by record.run_id, record.source_collection, record.source_record_id
        limit p_max_rows_per_store + 1
      ) as bounded_migration)
    union all select 'owner_auth',
      gioia_private.count_privacy_owner_auth_dry_run(
        p_normalized_email, p_max_rows_per_store
      )
  )
  insert into gioia_private.privacy_request_inventory (
    case_id, store_name, matched_rows, capped
  )
  select p_case_id, inventory.store_name,
    least(inventory.found, p_max_rows_per_store),
    inventory.found > p_max_rows_per_store
  from inventory;

  select sum(item.matched_rows)::integer,
    extensions.digest(pg_catalog.string_agg(
      item.store_name || ':' || item.matched_rows::text || ':' || item.capped::text,
      ',' order by item.store_name
    ), 'sha256')
  into strict v_total, v_artifact
  from gioia_private.privacy_request_inventory as item
  where item.case_id = p_case_id;

  insert into gioia_private.privacy_operation_evidence (
    case_id, policy_version, event_kind, row_count, artifact_sha256
  ) values (
    p_case_id, p_policy_version, 'inventory_created', v_total, v_artifact
  );

  return query
  select item.store_name, item.matched_rows, item.capped
  from gioia_private.privacy_request_inventory as item
  where item.case_id = p_case_id
  order by item.store_name;
exception when unique_violation then
  raise sqlstate 'PT409' using message = 'PRIVACY_CASE_ALREADY_EXISTS';
end;
$$;
reset role;
revoke create on schema gioia_private from gioia_migrator;
revoke all on function gioia_private.assert_privacy_policy_approved(text,text,text)
  from public, anon, authenticated, service_role, app_runtime, gioia_mutator;
revoke all on function gioia_private.count_privacy_owner_auth_dry_run(text,smallint)
  from public, anon, authenticated, service_role, app_runtime, gioia_mutator;
revoke all on function gioia_private.enforce_approved_privacy_policy_immutability()
  from public, anon, authenticated, service_role, app_runtime, gioia_mutator;
revoke all on function gioia_private.enforce_approved_privacy_decision_immutability()
  from public, anon, authenticated, service_role, app_runtime, gioia_mutator;
revoke all on function gioia_private.inventory_privacy_subject_dry_run(
  uuid,text,text,text,text,text,text,uuid,bytea,bytea,timestamptz,smallint
) from public, anon, authenticated, service_role, app_runtime, gioia_mutator;
grant execute on function gioia_private.inventory_privacy_subject_dry_run(
  uuid,text,text,text,text,text,text,uuid,bytea,bytea,timestamptz,smallint
) to postgres;
revoke gioia_migrator from postgres;

commit;
