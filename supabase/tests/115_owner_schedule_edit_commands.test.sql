begin;
grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;
set local search_path = extensions, public, pg_catalog;
select plan(24);
do $setup$
declare v_date date;
begin
  select day.value::date into strict v_date
  from generate_series(
    ((statement_timestamp() at time zone 'Europe/Rome')::date + 1)::timestamp,
    ((statement_timestamp() at time zone 'Europe/Rome')::date + 14)::timestamp,
    interval '1 day'
  ) as day(value)
  where extract(isodow from day.value) between 1 and 5
  order by day.value limit 1;
  perform set_config('gioia.test_edit_date', v_date::text, true);
end
$setup$;
with test_user as (
  insert into auth.users (
    instance_id, id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    'a1500000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'owner@edit-command.test',
    statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, statement_timestamp(), statement_timestamp()
  ) returning id
)
insert into gioia_private.owner_accounts (user_id) select id from test_user;
insert into gioia_private.owner_sessions (session_id, user_id, expires_at)
values ('a1510000-0000-4000-8000-000000000001',
  'a1500000-0000-4000-8000-000000000001', statement_timestamp()+interval '1 hour');
insert into gioia_private.schedule_entries (
  id, kind, status, source, local_date, start_minutes,
  service_duration_minutes, buffer_minutes, service_id, variant_id,
  service_name_snapshot, variant_name_snapshot, price_cents_snapshot,
  currency_snapshot, client_name, client_email, client_phone,
  client_note, internal_note, created_by
) values
  ('a1520000-0000-4000-8000-000000000001', 'appointment', 'confirmed', 'admin',
    current_setting('gioia.test_edit_date')::date, 600, 30, 5,
    'manicure', 'manicure-30-min', 'Manicure', 'Manicure', 0, 'EUR',
    'Cliente Dettaglio', 'detail-initial@edit.test', '+39000000151',
    'Nota privata iniziale', 'Memo privato iniziale',
    'a1500000-0000-4000-8000-000000000001'),
  ('a1520000-0000-4000-8000-000000000002', 'appointment', 'confirmed', 'admin',
    current_setting('gioia.test_edit_date')::date, 690, 30, 5,
    'manicure', 'manicure-30-min', 'Manicure', 'Manicure', 0, 'EUR',
    'Cliente Completato', 'completed-private@edit.test', null, null, null,
    'a1500000-0000-4000-8000-000000000001'),
  ('a1520000-0000-4000-8000-000000000003', 'appointment', 'confirmed', 'admin',
    current_setting('gioia.test_edit_date')::date, 780, 30, 5,
    'manicure', 'manicure-30-min', 'Manicure', 'Manicure', 0, 'EUR',
    'Cliente Assente', 'no-show-private@edit.test', null, null, null,
    'a1500000-0000-4000-8000-000000000001'),
  ('a1530000-0000-4000-8000-000000000001', 'block', 'active', 'admin',
    current_setting('gioia.test_edit_date')::date, 870, 30, 0,
    null, null, null, null, null, null, null, null, null, null,
    'Blocco riservato', 'a1500000-0000-4000-8000-000000000001');
do $claims$
begin
  perform set_config('request.jwt.claim.sub',
    'a1500000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.session_id',
    'a1510000-0000-4000-8000-000000000001', true);
end
$claims$;
set local role app_runtime;
select results_eq(
  $$select http_status, result->>'code', result->>'resource_id', replayed
    from gioia_private.owner_update_appointment_details(
      'a1500000-0000-4000-8000-000000000001', 'edit:appointment:success',
      decode(repeat('d1',32),'hex'), 'a1520000-0000-4000-8000-000000000001', 1,
      jsonb_build_object('client_name',' Cliente Modificato ',
        'client_email',' UPDATED-PRIVATE@EDIT.TEST ',
        'client_phone',' +39000000152 ', 'client_note',' Nota privata aggiornata ',
        'internal_note',' Memo privato aggiornato '))$$,
  $$values (200::smallint, 'APPOINTMENT_DETAILS_UPDATED'::text,
    'a1520000-0000-4000-8000-000000000001'::text, false)$$,
  'appointment details update returns its exact resource');
select results_eq(
  $$select http_status, result->>'code', replayed
    from gioia_private.owner_update_appointment_details(
      'a1500000-0000-4000-8000-000000000001', 'edit:appointment:success',
      decode(repeat('d1',32),'hex'), 'a1520000-0000-4000-8000-000000000001', 1,
      jsonb_build_object('client_name',' Cliente Modificato ',
        'client_email',' UPDATED-PRIVATE@EDIT.TEST ',
        'client_phone',' +39000000152 ', 'client_note',' Nota privata aggiornata ',
        'internal_note',' Memo privato aggiornato '))$$,
  $$values (200::smallint, 'APPOINTMENT_DETAILS_UPDATED'::text, true)$$,
  'appointment details update replays without another write');
select results_eq(
  $$select http_status, result->>'code' from gioia_private.owner_update_appointment_details(
    'a1500000-0000-4000-8000-000000000001', 'edit:appointment:no-change',
    decode(repeat('d2',32),'hex'), 'a1520000-0000-4000-8000-000000000001', 2,
    jsonb_build_object('client_name','Cliente Modificato',
      'client_email','updated-private@edit.test', 'client_phone','+39000000152',
      'client_note','Nota privata aggiornata', 'internal_note','Memo privato aggiornato'))$$,
  $$values (400::smallint, 'APPOINTMENT_DETAILS_NO_CHANGE'::text)$$,
  'appointment details reject a normalized no-op');
select results_eq(
  $$select http_status, result->>'code' from gioia_private.owner_update_appointment_details(
    'a1500000-0000-4000-8000-000000000001', 'edit:appointment:stale',
    decode(repeat('d3',32),'hex'), 'a1520000-0000-4000-8000-000000000001', 1,
    jsonb_build_object('client_name','Cliente Stale'))$$,
  $$values (409::smallint, 'VERSION_CONFLICT'::text)$$,
  'appointment details reject a stale version');
select results_eq(
  $$select http_status, result->>'code' from gioia_private.owner_update_appointment_details(
    'a1500000-0000-4000-8000-000000000001', 'edit:appointment:missing',
    decode(repeat('d4',32),'hex'), 'a1590000-0000-4000-8000-000000000099', 1,
    jsonb_build_object('client_name','Cliente Mancante'))$$,
  $$values (404::smallint, 'APPOINTMENT_NOT_FOUND'::text)$$,
  'appointment details reject an absent resource');
reset role;
select results_eq(
  $$select client_name, client_email::text, client_phone, client_note,
      internal_note, version from gioia_private.schedule_entries
    where id='a1520000-0000-4000-8000-000000000001'$$,
  $$values ('Cliente Modificato'::text, 'updated-private@edit.test'::text,
    '+39000000152'::text, 'Nota privata aggiornata'::text,
    'Memo privato aggiornato'::text, 2)$$,
  'only the successful normalized detail patch advances the row');
set local role app_runtime;
select results_eq(
  $$select http_status, result->>'code', result->>'resource_id', replayed
    from gioia_private.owner_update_block_details(
      'a1500000-0000-4000-8000-000000000001', 'edit:block:success',
      decode(repeat('e1',32),'hex'), 'a1530000-0000-4000-8000-000000000001', 1,
      ' Blocco aggiornato ')$$,
  $$values (200::smallint, 'BLOCK_DETAILS_UPDATED'::text,
    'a1530000-0000-4000-8000-000000000001'::text, false)$$,
  'block details update returns its exact resource');
select results_eq(
  $$select http_status, result->>'code', replayed
    from gioia_private.owner_update_block_details(
      'a1500000-0000-4000-8000-000000000001', 'edit:block:success',
      decode(repeat('e1',32),'hex'), 'a1530000-0000-4000-8000-000000000001', 1,
      ' Blocco aggiornato ')$$,
  $$values (200::smallint, 'BLOCK_DETAILS_UPDATED'::text, true)$$,
  'block details update replays without another write');
reset role;
select results_eq(
  $$select internal_note, version from gioia_private.schedule_entries
    where id='a1530000-0000-4000-8000-000000000001'$$,
  $$values ('Blocco aggiornato'::text, 2)$$,
  'block detail replay preserves the single normalized update');
set local role app_runtime;
select results_eq(
  $$select http_status, result->>'code', result->>'resource_id', replayed
    from gioia_private.owner_set_appointment_status(
      'a1500000-0000-4000-8000-000000000001', 'status:completed:success',
      decode(repeat('f1',32),'hex'), 'a1520000-0000-4000-8000-000000000002',
      1, 'completed')$$,
  $$values (200::smallint, 'APPOINTMENT_STATUS_UPDATED'::text,
    'a1520000-0000-4000-8000-000000000002'::text, false)$$,
  'confirmed appointment transitions to completed');
select results_eq(
  $$select http_status, result->>'code', replayed
    from gioia_private.owner_set_appointment_status(
      'a1500000-0000-4000-8000-000000000001', 'status:completed:success',
      decode(repeat('f1',32),'hex'), 'a1520000-0000-4000-8000-000000000002',
      1, 'completed')$$,
  $$values (200::smallint, 'APPOINTMENT_STATUS_UPDATED'::text, true)$$,
  'completed status command replays after the row version changes');
select results_eq(
  $$select http_status, result->>'code' from gioia_private.owner_set_appointment_status(
    'a1500000-0000-4000-8000-000000000001', 'status:completed:invalid',
    decode(repeat('f2',32),'hex'), 'a1520000-0000-4000-8000-000000000002',
    2, 'no_show')$$,
  $$values (409::smallint, 'STATUS_TRANSITION_INVALID'::text)$$,
  'terminal appointment rejects another status transition');
reset role;
select results_eq(
  $$select status, version from gioia_private.schedule_entries
    where id='a1520000-0000-4000-8000-000000000002'$$,
  $$values ('completed'::text, 2)$$,
  'completed appointment remains at its successful version'
);
set local role app_runtime;
select results_eq(
  $$select http_status, result->>'code' from gioia_private.owner_set_appointment_status(
    'a1500000-0000-4000-8000-000000000001', 'status:no-show:stale',
    decode(repeat('f3',32),'hex'), 'a1520000-0000-4000-8000-000000000003',
    99, 'no_show')$$,
  $$values (409::smallint, 'VERSION_CONFLICT'::text)$$,
  'no-show command rejects a stale version'
);
reset role;
select results_eq(
  $$select status, version from gioia_private.schedule_entries
    where id='a1520000-0000-4000-8000-000000000003'$$,
  $$values ('confirmed'::text, 1)$$,
  'stale no-show command preserves the confirmed appointment'
);
set local role app_runtime;
select results_eq(
  $$select http_status, result->>'code', result->>'resource_id', replayed
    from gioia_private.owner_set_appointment_status(
      'a1500000-0000-4000-8000-000000000001', 'status:no-show:success',
      decode(repeat('f4',32),'hex'), 'a1520000-0000-4000-8000-000000000003',
      1, 'no_show')$$,
  $$values (200::smallint, 'APPOINTMENT_STATUS_UPDATED'::text,
    'a1520000-0000-4000-8000-000000000003'::text, false)$$,
  'confirmed appointment transitions to no-show'
);
select results_eq(
  $$select http_status, result->>'code', replayed
    from gioia_private.owner_set_appointment_status(
      'a1500000-0000-4000-8000-000000000001', 'status:no-show:success',
      decode(repeat('f4',32),'hex'), 'a1520000-0000-4000-8000-000000000003',
      1, 'no_show')$$,
  $$values (200::smallint, 'APPOINTMENT_STATUS_UPDATED'::text, true)$$,
  'no-show status command replays after the row version changes'
);
reset role;
select results_eq(
  $$select status, version from gioia_private.schedule_entries
    where id='a1520000-0000-4000-8000-000000000003'$$,
  $$values ('no_show'::text, 2)$$,
  'no-show appointment remains at its successful version'
);
select results_eq(
  $$select aggregate_id, aggregate_version, change_kind, changed_fields
    from gioia_private.domain_change_log order by sequence_id$$,
  $$values
    ('a1520000-0000-4000-8000-000000000001'::uuid, 2, 'update'::text,
      array['client_name','client_email','client_phone','client_note','internal_note']::text[]),
    ('a1530000-0000-4000-8000-000000000001'::uuid, 2, 'update'::text,
      array['internal_note']::text[]),
    ('a1520000-0000-4000-8000-000000000002'::uuid, 2, 'update'::text,
      array['status']::text[]),
    ('a1520000-0000-4000-8000-000000000003'::uuid, 2, 'update'::text,
      array['status']::text[])$$,
  'only four successful mutations append exact versioned audit rows'
);
select results_eq(
  $$select operation, idempotency_key, state, http_status, coalesce(error_code,'')
    from gioia_private.command_requests order by operation, idempotency_key$$,
  $$values
    ('owner_set_appointment_status'::text,'status:completed:invalid'::text,'failed'::text,409::smallint,'STATUS_TRANSITION_INVALID'::text),
    ('owner_set_appointment_status'::text,'status:completed:success'::text,'completed'::text,200::smallint,''::text),
    ('owner_set_appointment_status'::text,'status:no-show:stale'::text,'failed'::text,409::smallint,'VERSION_CONFLICT'::text),
    ('owner_set_appointment_status'::text,'status:no-show:success'::text,'completed'::text,200::smallint,''::text),
    ('owner_update_appointment_details'::text,'edit:appointment:missing'::text,'failed'::text,404::smallint,'APPOINTMENT_NOT_FOUND'::text),
    ('owner_update_appointment_details'::text,'edit:appointment:no-change'::text,'failed'::text,400::smallint,'APPOINTMENT_DETAILS_NO_CHANGE'::text),
    ('owner_update_appointment_details'::text,'edit:appointment:stale'::text,'failed'::text,409::smallint,'VERSION_CONFLICT'::text),
    ('owner_update_appointment_details'::text,'edit:appointment:success'::text,'completed'::text,200::smallint,''::text),
    ('owner_update_block_details'::text,'edit:block:success'::text,'completed'::text,200::smallint,''::text)$$,
  'command ledger stores each deterministic outcome exactly once'
);
select ok(
  (select count(*) from gioia_private.command_requests where state='completed') = 4
  and not exists (
    select 1 from gioia_private.command_requests as command
    where (command.state='completed' and (
      command.resource_kind <> 'schedule_entry' or command.resource_id is null
      or command.response_snapshot <> jsonb_build_object(
        'code', command.response_snapshot->>'code', 'resource_id', command.resource_id)))
      or (command.state='failed' and (
        command.resource_kind is not null or command.resource_id is not null
        or command.response_snapshot <> jsonb_build_object('code',command.error_code)))
  ),
  'completed and failed command snapshots keep exact resource-safe shapes'
);
select ok(not exists (
  select 1 from unnest(array[
    'Cliente Dettaglio','detail-initial@edit.test','+39000000151',
    'Nota privata iniziale','Memo privato iniziale','Cliente Modificato',
    'updated-private@edit.test','+39000000152','Nota privata aggiornata',
    'Memo privato aggiornato','Cliente Stale','Cliente Mancante',
    'Cliente Completato','completed-private@edit.test','Cliente Assente',
    'no-show-private@edit.test','Blocco riservato','Blocco aggiornato'
  ]) as secret(value)
  where exists (select 1 from gioia_private.command_requests as command
    where strpos(to_jsonb(command)::text, secret.value) > 0)
    or exists (select 1 from gioia_private.domain_change_log as change
      where strpos(to_jsonb(change)::text, secret.value) > 0)
    or exists (select 1 from gioia_private.email_outbox as email
      where strpos(to_jsonb(email)::text, secret.value) > 0)
), 'command responses, audit rows, and outbox contain no customer values');
select is((select count(*) from gioia_private.email_outbox), 0::bigint,
  'detail and status commands enqueue no email');
select results_eq(
  $$select id, kind, status, version from gioia_private.schedule_entries
    order by id$$,
  $$values
    ('a1520000-0000-4000-8000-000000000001'::uuid,'appointment'::text,'confirmed'::text,2),
    ('a1520000-0000-4000-8000-000000000002'::uuid,'appointment'::text,'completed'::text,2),
    ('a1520000-0000-4000-8000-000000000003'::uuid,'appointment'::text,'no_show'::text,2),
    ('a1530000-0000-4000-8000-000000000001'::uuid,'block'::text,'active'::text,2)$$,
  'all four fixtures reconcile to exact final statuses and versions'
);
select * from finish();
rollback;
