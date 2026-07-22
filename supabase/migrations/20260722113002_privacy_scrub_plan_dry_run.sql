begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_migrator to postgres;
grant create on schema gioia_private to gioia_migrator;

set local role gioia_migrator;

create function gioia_private.plan_privacy_scrub_dry_run(
  p_case_id uuid,
  p_max_total_rows integer
)
returns table (
  store_name text,
  matched_rows integer,
  field_codes text[],
  decision_ids text[]
)
language plpgsql
volatile
security definer
set search_path = ''
rows 8
as $$
declare
  v_request gioia_private.privacy_subject_requests%rowtype;
  v_policy gioia_private.privacy_policy_versions%rowtype;
  v_total integer;
  v_artifact bytea;
begin
  if p_case_id is null
    or p_max_total_rows is null
    or p_max_total_rows not between 1 and 10000 then
    raise sqlstate 'PT400' using message = 'PRIVACY_SCRUB_PLAN_INVALID';
  end if;

  select request.* into v_request
  from gioia_private.privacy_subject_requests as request
  where request.case_id = p_case_id
  for update;
  if not found or v_request.request_kind <> 'erasure'
    or v_request.status not in ('inventory_ready', 'scrub_planned') then
    raise sqlstate 'PT409' using message = 'PRIVACY_REQUEST_NOT_PLANNABLE';
  end if;

  select policy.* into strict v_policy
  from gioia_private.privacy_policy_versions as policy
  where policy.policy_version = v_request.policy_version;
  perform gioia_private.assert_privacy_policy_approved(
    v_policy.policy_version, v_policy.environment, v_policy.target_id
  );

  if exists (
    select 1 from gioia_private.privacy_holds as hold
    where hold.case_id = p_case_id and hold.released_at is null
      and hold.starts_at <= pg_catalog.statement_timestamp()
      and hold.expires_at > pg_catalog.statement_timestamp()
  ) then
    raise sqlstate 'PT409' using message = 'PRIVACY_HOLD_ACTIVE';
  end if;

  select sum(item.matched_rows)::integer into strict v_total
  from gioia_private.privacy_request_inventory as item
  where item.case_id = p_case_id;
  if v_total > p_max_total_rows or exists (
    select 1 from gioia_private.privacy_request_inventory as item
    where item.case_id = p_case_id and item.capped
  ) then
    raise sqlstate 'PT409' using message = 'PRIVACY_BOUND_EXCEEDED';
  end if;

  if v_request.status = 'inventory_ready' then
    insert into gioia_private.privacy_scrub_plan_items (
      case_id, store_name, matched_rows, field_codes, decision_ids
    )
    select item.case_id, item.store_name, item.matched_rows,
      case item.store_name
        when 'schedule_entries' then array[
          'client_name','client_email','client_phone','client_note',
          'internal_note','cancellation_reason','legacy_firestore_id']
        when 'newsletter_subscribers' then array[
          'email','legacy_firestore_id','consent_evidence']
        when 'email_outbox' then array[
          'recipient_address','template_data','provider_message_id']
        when 'email_webhook_events' then array[
          'provider_event_id','provider_message_id','payload_sha256']
        when 'command_requests' then array[
          'principal_scope_hash','request_fingerprint','response_snapshot']
        when 'domain_change_log' then array[
          'aggregate_id','actor_user_id','command_request_id']
        when 'migration_evidence' then array[
          'source_record_id','source_record_sha256','target_id']
        else array['user_id','session_evidence']
      end,
      case item.store_name
        when 'schedule_entries' then array['RET-01','RET-02','RET-03','RET-10']
        when 'newsletter_subscribers' then array['RET-04','RET-05','RET-10']
        when 'email_outbox' then array['RET-06','RET-15']
        when 'email_webhook_events' then array['RET-07','RET-15']
        when 'command_requests' then array['RET-08']
        when 'domain_change_log' then array['RET-09']
        when 'migration_evidence' then array['RET-10']
        else array['RET-11','RET-17']
      end
    from gioia_private.privacy_request_inventory as item
    where item.case_id = p_case_id;

    select extensions.digest(pg_catalog.string_agg(
      item.store_name || ':' || item.matched_rows::text || ':'
        || pg_catalog.array_to_string(item.field_codes, ',') || ':'
        || pg_catalog.array_to_string(item.decision_ids, ','),
      '|' order by item.store_name
    ), 'sha256')
    into strict v_artifact
    from gioia_private.privacy_scrub_plan_items as item
    where item.case_id = p_case_id;

    insert into gioia_private.privacy_operation_evidence (
      case_id, policy_version, event_kind, row_count, artifact_sha256
    ) values (
      p_case_id, v_request.policy_version, 'scrub_plan_created',
      v_total, v_artifact
    );
    update gioia_private.privacy_subject_requests
    set status = 'scrub_planned', updated_at = pg_catalog.statement_timestamp()
    where case_id = p_case_id;
  end if;

  return query
  select item.store_name, item.matched_rows, item.field_codes, item.decision_ids
  from gioia_private.privacy_scrub_plan_items as item
  where item.case_id = p_case_id
  order by item.store_name;
end;
$$;

reset role;

revoke create on schema gioia_private from gioia_migrator;
revoke all on function gioia_private.plan_privacy_scrub_dry_run(uuid,integer)
  from public, anon, authenticated, service_role, app_runtime, gioia_mutator;
grant execute on function gioia_private.plan_privacy_scrub_dry_run(uuid,integer)
  to postgres;
revoke gioia_migrator from postgres;

commit;
