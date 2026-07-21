begin;

alter table gioia_private.cutover_canary_grants
  drop constraint cutover_canary_grants_operation_known;

alter table gioia_private.cutover_canary_grants
  add constraint cutover_canary_grants_operation_known check (operation in (
    'public_booking',
    'owner_create_appointment',
    'owner_create_block',
    'owner_cancel_schedule_entry',
    'owner_create_vacation',
    'owner_cancel_vacation'
  ));

commit;
