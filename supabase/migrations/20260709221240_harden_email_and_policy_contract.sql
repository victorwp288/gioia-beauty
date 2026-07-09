begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table gioia_private.booking_policy
  add constraint booking_policy_reviewed_values_fixed check (
    timezone = 'Europe/Rome'
    and slot_alignment_minutes = 15
    and not public_same_day_allowed
    and public_min_lead_minutes = 0
    and public_max_advance_days = 60
    and maximum_vacation_days = 366
    and not admin_conflict_override
    and not buffer_visible_to_customer
    and vacation_conflict_behavior = 'reject'
    and completed_transition = 'owner_explicit'
  ),
  add constraint booking_policy_admin_email_format check (
    admin_notification_email::text = pg_catalog.lower(
      pg_catalog.btrim(admin_notification_email::text)
    )
    and admin_notification_email::text
      ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  );

alter table gioia_private.schedule_entries
  add constraint schedule_entries_client_email_format check (
    client_email is null
    or client_email::text
      ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  );

alter table gioia_private.newsletter_subscribers
  add constraint newsletter_subscribers_email_format check (
    email::text ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  );

alter table gioia_private.email_outbox
  add constraint email_outbox_recipient_email_format check (
    recipient_address::text
      ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  );

commit;
