-- Generated from lib/domain/catalog/manifest.ts.
-- Manifest SHA-256: 74f97f4fcae84e19158bd8fba9d6386c446539feef0c4998d47c760d5c1c34b7
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into gioia_private.service_categories (
  id,
  display_name_it,
  sort_order,
  active
)
values
  ('bagno-turco', 'Bagno Turco', 0, true),
  ('ceretta', 'Ceretta', 1, true),
  ('ciglia-sopracciglia', 'Ciglia e Sopracciglia', 2, true),
  ('laser', 'Laser', 3, true),
  ('lpg', 'Lpg Endermologie', 4, true),
  ('makeup', 'Makeup', 5, true),
  ('manicure', 'Manicure', 6, true),
  ('massaggi', 'Massaggi', 7, true),
  ('pedicure', 'Pedicure', 8, true),
  ('rituali', 'Rituali', 9, true),
  ('trattamenti-corpo', 'Trattamenti Corpo', 10, true),
  ('trattamenti-viso', 'Trattamenti Viso', 11, true);

do $catalog_count$
begin
  if (select count(*) from gioia_private.service_categories) <> 12 then
    raise exception 'Unexpected service_categories row count';
  end if;
end
$catalog_count$;

commit;
