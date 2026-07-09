-- Local/CI seed entrypoint. Keep every row synthetic and deterministic.
-- Catalog reference data is versioned in migrations, not seeded here.

begin;

set time zone 'Europe/Rome';

commit;
