begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index vacations_owner_page_idx
  on gioia_private.vacations (start_date, id);
create index vacations_date_span_idx
  on gioia_private.vacations using gist (date_span);
create index newsletter_subscribers_owner_page_idx
  on gioia_private.newsletter_subscribers (created_at desc, id desc);
create index newsletter_subscribers_owner_status_page_idx
  on gioia_private.newsletter_subscribers (status, created_at desc, id desc);
create index email_outbox_owner_page_idx
  on gioia_private.email_outbox (created_at desc, id desc);
create index email_outbox_owner_status_page_idx
  on gioia_private.email_outbox (status, created_at desc, id desc);

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.list_vacations_as_owner(
  p_actor_user_id uuid,
  p_from_date date,
  p_to_date date,
  p_after_start_date date,
  p_after_id uuid,
  p_limit smallint
)
returns table (item jsonb)
language plpgsql
stable
security definer
set search_path = ''
rows 101
as $$
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  if p_from_date is null or p_to_date is null
    or p_to_date - p_from_date not between 0 and 365 then
    raise sqlstate 'PT400' using message = 'VACATION_RANGE_INVALID';
  end if;
  if (p_after_start_date is null) <> (p_after_id is null) then
    raise sqlstate 'PT400' using message = 'VACATION_CURSOR_INVALID';
  end if;
  if p_limit is null or p_limit not between 1 and 101 then
    raise sqlstate 'PT400' using message = 'VACATION_LIMIT_INVALID';
  end if;

  return query
  select pg_catalog.jsonb_build_object(
    'id', vacation.id::text,
    'schemaVersion', vacation.schema_version,
    'startDate', vacation.start_date::text,
    'endDate', vacation.end_date::text,
    'status', vacation.status,
    'reason', vacation.reason,
    'source', vacation.source,
    'cancelledAt', case when vacation.cancelled_at is null then null else
      pg_catalog.to_char(vacation.cancelled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'cancelledBy', vacation.cancelled_by::text,
    'version', vacation.version,
    'createdAt', pg_catalog.to_char(vacation.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', pg_catalog.to_char(vacation.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
  from gioia_private.vacations as vacation
  where vacation.date_span && pg_catalog.daterange(p_from_date, p_to_date + 1, '[)')
    and (p_after_start_date is null
      or (vacation.start_date, vacation.id) > (p_after_start_date, p_after_id))
  order by vacation.start_date, vacation.id
  limit p_limit;
end;
$$;

create function gioia_private.list_newsletter_subscribers_as_owner(
  p_actor_user_id uuid,
  p_statuses text[],
  p_after_created_at timestamptz,
  p_after_id uuid,
  p_limit smallint
)
returns table (cursor_created_at text, item jsonb)
language plpgsql
stable
security definer
set search_path = ''
rows 101
as $$
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  if p_statuses is null or pg_catalog.cardinality(p_statuses) > 6
    or pg_catalog.array_position(p_statuses, null::text) is not null
    or exists (
      select 1 from pg_catalog.unnest(p_statuses) as candidate(value)
      where candidate.value not in (
        'legacy_unverified', 'pending', 'active', 'unsubscribed', 'bounced', 'complained'
      )
    )
    or pg_catalog.cardinality(p_statuses) <> (
      select pg_catalog.count(distinct candidate.value)::integer
      from pg_catalog.unnest(p_statuses) as candidate(value)
    ) then
    raise sqlstate 'PT400' using message = 'SUBSCRIBER_STATUSES_INVALID';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise sqlstate 'PT400' using message = 'SUBSCRIBER_CURSOR_INVALID';
  end if;
  if p_limit is null or p_limit not between 1 and 101 then
    raise sqlstate 'PT400' using message = 'SUBSCRIBER_LIMIT_INVALID';
  end if;

  return query
  select
    pg_catalog.to_char(subscriber.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    pg_catalog.jsonb_build_object(
      'id', subscriber.id::text,
      'schemaVersion', subscriber.schema_version,
      'email', subscriber.email::text,
      'status', subscriber.status,
      'source', subscriber.source,
      'consentAt', case when subscriber.consent_at is null then null else
        pg_catalog.to_char(subscriber.consent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'consentSource', subscriber.consent_source,
      'consentPolicyVersion', subscriber.consent_policy_version,
      'confirmedAt', case when subscriber.confirmed_at is null then null else
        pg_catalog.to_char(subscriber.confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'unsubscribedAt', case when subscriber.unsubscribed_at is null then null else
        pg_catalog.to_char(subscriber.unsubscribed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'version', subscriber.version,
      'createdAt', pg_catalog.to_char(subscriber.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(subscriber.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  from gioia_private.newsletter_subscribers as subscriber
  where (pg_catalog.cardinality(p_statuses) = 0 or subscriber.status = any(p_statuses))
    and (p_after_created_at is null
      or (subscriber.created_at, subscriber.id) < (p_after_created_at, p_after_id))
  order by subscriber.created_at desc, subscriber.id desc
  limit p_limit;
end;
$$;

create function gioia_private.list_email_outbox_as_owner(
  p_actor_user_id uuid,
  p_statuses text[],
  p_after_created_at timestamptz,
  p_after_id uuid,
  p_limit smallint
)
returns table (cursor_created_at text, item jsonb)
language plpgsql
stable
security definer
set search_path = ''
rows 101
as $$
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  if p_statuses is null or pg_catalog.cardinality(p_statuses) > 7
    or pg_catalog.array_position(p_statuses, null::text) is not null
    or exists (
      select 1 from pg_catalog.unnest(p_statuses) as candidate(value)
      where candidate.value not in (
        'pending', 'sending', 'sent', 'failed', 'dead_letter', 'bounced', 'complained'
      )
    )
    or pg_catalog.cardinality(p_statuses) <> (
      select pg_catalog.count(distinct candidate.value)::integer
      from pg_catalog.unnest(p_statuses) as candidate(value)
    ) then
    raise sqlstate 'PT400' using message = 'OUTBOX_STATUSES_INVALID';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise sqlstate 'PT400' using message = 'OUTBOX_CURSOR_INVALID';
  end if;
  if p_limit is null or p_limit not between 1 and 101 then
    raise sqlstate 'PT400' using message = 'OUTBOX_LIMIT_INVALID';
  end if;

  return query
  select
    pg_catalog.to_char(outbox.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    pg_catalog.jsonb_build_object(
      'id', outbox.id::text,
      'aggregateKind', outbox.aggregate_kind,
      'aggregateId', outbox.aggregate_id::text,
      'aggregateVersion', outbox.aggregate_version,
      'recipientKind', outbox.recipient_kind,
      'recipientAddress', outbox.recipient_address::text,
      'templateKind', outbox.template_kind,
      'status', outbox.status,
      'providerMessageId', outbox.provider_message_id,
      'attemptCount', outbox.attempt_count,
      'nextAttemptAt', pg_catalog.to_char(outbox.next_attempt_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'lastErrorCode', outbox.last_error_code,
      'sentAt', case when outbox.sent_at is null then null else
        pg_catalog.to_char(outbox.sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'version', outbox.version,
      'createdAt', pg_catalog.to_char(outbox.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', pg_catalog.to_char(outbox.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  from gioia_private.email_outbox as outbox
  where (pg_catalog.cardinality(p_statuses) = 0 or outbox.status = any(p_statuses))
    and (p_after_created_at is null
      or (outbox.created_at, outbox.id) < (p_after_created_at, p_after_id))
  order by outbox.created_at desc, outbox.id desc
  limit p_limit;
end;
$$;

reset role;

revoke create on schema gioia_private from gioia_mutator;

revoke all on function gioia_private.list_vacations_as_owner(
  uuid,date,date,date,uuid,smallint
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.list_newsletter_subscribers_as_owner(
  uuid,text[],timestamptz,uuid,smallint
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.list_email_outbox_as_owner(
  uuid,text[],timestamptz,uuid,smallint
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.list_vacations_as_owner(
  uuid,date,date,date,uuid,smallint
) to app_runtime;
grant execute on function gioia_private.list_newsletter_subscribers_as_owner(
  uuid,text[],timestamptz,uuid,smallint
) to app_runtime;
grant execute on function gioia_private.list_email_outbox_as_owner(
  uuid,text[],timestamptz,uuid,smallint
) to app_runtime;

revoke gioia_mutator from postgres;

commit;
