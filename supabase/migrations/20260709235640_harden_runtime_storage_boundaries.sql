begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table gioia_private.email_outbox
  add constraint email_outbox_template_data_shape check (
    case when jsonb_typeof(template_data) = 'object' then (
      (template_kind = 'newsletter_confirmation' and (
        template_data ? 'policy_version'
        and template_data - 'policy_version' = '{}'::jsonb
        and jsonb_typeof(template_data -> 'policy_version') = 'string'
        and length(btrim(template_data ->> 'policy_version')) between 1 and 100
      ))
      or (template_kind <> 'newsletter_confirmation' and (
        template_data ?& array[
          'client_name', 'local_date', 'start_minutes',
          'service_duration_minutes', 'service_name', 'variant_name'
        ]
        and template_data - array[
          'client_name', 'local_date', 'start_minutes',
          'service_duration_minutes', 'service_name', 'variant_name',
          'old_local_date', 'old_start_minutes'
        ] = '{}'::jsonb
        and jsonb_typeof(template_data -> 'client_name') = 'string'
        and length(btrim(template_data ->> 'client_name')) between 1 and 160
        and jsonb_typeof(template_data -> 'local_date') = 'string'
        and (template_data ->> 'local_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and jsonb_typeof(template_data -> 'start_minutes') = 'number'
        and case when (template_data ->> 'start_minutes') ~ '^(0|[1-9][0-9]{0,3})$'
          then (template_data ->> 'start_minutes')::integer between 0 and 1439
          else false end
        and jsonb_typeof(template_data -> 'service_duration_minutes') = 'number'
        and case when (template_data ->> 'service_duration_minutes')
          ~ '^[1-9][0-9]{0,2}$'
          then (template_data ->> 'service_duration_minutes')::integer between 1 and 480
          else false end
        and jsonb_typeof(template_data -> 'service_name') = 'string'
        and length(btrim(template_data ->> 'service_name')) between 1 and 160
        and jsonb_typeof(template_data -> 'variant_name') = 'string'
        and length(btrim(template_data ->> 'variant_name')) between 1 and 160
        and (
          (template_kind in ('reschedule_customer', 'reschedule_owner') and (
            template_data ?& array['old_local_date', 'old_start_minutes']
            and jsonb_typeof(template_data -> 'old_local_date') = 'string'
            and (template_data ->> 'old_local_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            and jsonb_typeof(template_data -> 'old_start_minutes') = 'number'
            and case when (template_data ->> 'old_start_minutes')
              ~ '^(0|[1-9][0-9]{0,3})$'
              then (template_data ->> 'old_start_minutes')::integer between 0 and 1439
              else false end
          ))
          or (template_kind not in ('reschedule_customer', 'reschedule_owner')
            and not (template_data ? 'old_local_date')
            and not (template_data ? 'old_start_minutes'))
        )
      ))
    ) else false end
  );

revoke delete on table
  gioia_private.owner_accounts,
  gioia_private.vacations,
  gioia_private.schedule_entries,
  gioia_private.newsletter_subscribers,
  gioia_private.email_outbox,
  gioia_private.email_webhook_events
from gioia_mutator;

revoke update, delete on table gioia_private.schedule_day_locks from gioia_mutator;

commit;
