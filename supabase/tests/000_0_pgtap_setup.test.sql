create extension if not exists pgtap with schema extensions;

begin;

set local search_path = extensions, public, pg_catalog;

select plan(1);

select has_extension('pgtap', 'pgTAP is enabled only for database tests');

select * from finish();

rollback;
