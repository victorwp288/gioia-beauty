begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table gioia_private.schedule_entries
  drop constraint schedule_entries_public_shape,
  add constraint schedule_entries_public_shape check (
    source <> 'public'
    or (kind = 'appointment' and created_by is null)
  );

create or replace function gioia_private.enforce_schedule_entry_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    old.id, old.schema_version, old.kind, old.source, old.legacy_firestore_id,
    old.timestamp_provenance, old.imported_at, old.created_at
  ) is distinct from row(
    new.id, new.schema_version, new.kind, new.source, new.legacy_firestore_id,
    new.timestamp_provenance, new.imported_at, new.created_at
  ) then
    raise exception using errcode = '23514',
      message = 'Schedule identity and provenance are immutable';
  end if;

  if old.status <> new.status and not (
    (old.kind = 'appointment' and old.status = 'confirmed'
      and new.status in ('completed', 'cancelled', 'no_show'))
    or (old.kind = 'block' and old.status = 'active' and new.status = 'cancelled')
  ) then
    raise exception using errcode = '23514',
      message = 'Invalid schedule status transition';
  end if;

  if old.status in ('completed', 'cancelled', 'no_show')
    and (
      pg_catalog.to_jsonb(old) - array[
        'version', 'updated_at', 'created_by',
        'client_name', 'client_email', 'client_phone', 'client_note',
        'internal_note', 'occupied_span'
      ]
      is distinct from
      pg_catalog.to_jsonb(new) - array[
        'version', 'updated_at', 'created_by',
        'client_name', 'client_email', 'client_phone', 'client_note',
        'internal_note', 'occupied_span'
      ]
    ) then
    raise exception using errcode = '23514',
      message = 'Terminal schedule occupancy and evidence are immutable';
  end if;

  return new;
end;
$$;

revoke all on function gioia_private.enforce_schedule_entry_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.enforce_schedule_entry_transition()
  to gioia_mutator;

commit;
