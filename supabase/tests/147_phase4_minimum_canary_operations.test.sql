begin;
grant gioia_mutator to postgres;
grant usage on schema extensions to gioia_mutator;
set local search_path = extensions, public, pg_catalog;
select plan(2);

set local role gioia_mutator;
create temporary table canary_operation_probe (
  operation text primary key,
  accepted boolean not null
) on commit drop;
do $probe$
declare
  v_freeze_id uuid;
  v_run_id uuid;
  v_operation text;
  v_accepted boolean;
begin
  select freeze_id into strict v_freeze_id
  from gioia_private.begin_cutover_write_freeze('MINIMUM_CANARY_TEST');
  v_run_id := gioia_private.begin_cutover_canary_run(
    v_freeze_id,
    'MINIMUM_CANARY_TEST',
    statement_timestamp() + interval '20 minutes'
  );

  foreach v_operation in array array[
    'public_booking', 'owner_create_appointment', 'owner_create_block',
    'owner_update_appointment_details', 'owner_update_block_details',
    'owner_reschedule_appointment', 'owner_reschedule_block',
    'owner_set_appointment_status', 'owner_cancel_schedule_entry',
    'owner_create_vacation', 'owner_update_vacation', 'owner_cancel_vacation',
    'owner_unsubscribe_subscriber', 'owner_outbox_retry'
  ] loop
    begin
      perform gioia_private.issue_cutover_canary_grant(
        v_run_id,
        extensions.digest(v_operation, 'sha256'),
        v_operation,
        extensions.gen_random_uuid()::text,
        extensions.digest('request-' || v_operation, 'sha256'),
        statement_timestamp() + interval '10 minutes'
      );
      v_accepted := true;
    exception when check_violation then
      v_accepted := false;
    end;
    insert into canary_operation_probe values (v_operation, v_accepted);
  end loop;
end
$probe$;

reset role;
select results_eq(
  $$select operation from canary_operation_probe where accepted order by operation$$,
  $$values
    ('owner_cancel_schedule_entry'::text), ('owner_cancel_vacation'::text),
    ('owner_create_appointment'::text), ('owner_create_block'::text),
    ('owner_create_vacation'::text), ('public_booking'::text)$$,
  'only the minimum runbook canary operations are accepted'
);
select is(
  (select count(*) from canary_operation_probe where not accepted),
  8::bigint,
  'all broader mutation operations are rejected as canary grants'
);

select * from finish();
rollback;
