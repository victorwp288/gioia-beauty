begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Migrations must run as the constrained postgres principal';
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'gioia_mutator') then
    create role gioia_mutator
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'gioia_migrator') then
    create role gioia_migrator
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname in ('app_runtime', 'gioia_mutator', 'gioia_migrator')
      and (rolsuper or rolreplication or rolbypassrls)
  ) then
    raise exception 'Application roles must not have superuser, replication, or bypass-RLS attributes';
  end if;
end
$$;

-- Supabase migrations run as a constrained CREATEROLE principal. PostgreSQL
-- reserves toggling SUPERUSER, REPLICATION, and BYPASSRLS for a superuser even
-- when the requested value is false, so those attributes are asserted above.
alter role app_runtime nologin nocreatedb nocreaterole noinherit;
alter role gioia_mutator nologin nocreatedb nocreaterole noinherit;
alter role gioia_migrator nologin nocreatedb nocreaterole noinherit;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    where granted_role.rolname in (
      'app_runtime', 'gioia_mutator', 'gioia_migrator'
    )
      and member_role.rolname in (
        'app_runtime', 'gioia_mutator', 'gioia_migrator',
        'anon', 'authenticated', 'service_role'
      )
  ) then
    raise exception 'Application and API roles must not have cross-membership';
  end if;
end
$$;

alter role app_runtime set statement_timeout = '10s';
alter role app_runtime set lock_timeout = '3s';
alter role gioia_mutator set statement_timeout = '10s';
alter role gioia_mutator set lock_timeout = '3s';
alter role gioia_migrator set statement_timeout = '5min';
alter role gioia_migrator set lock_timeout = '5s';

create schema if not exists gioia_private authorization postgres;

revoke all on schema gioia_private from public;
revoke all on schema gioia_private from anon;
revoke all on schema gioia_private from authenticated;
revoke all on schema gioia_private from service_role;
grant usage on schema gioia_private to app_runtime;
grant usage on schema gioia_private to gioia_mutator;
grant usage on schema gioia_private to gioia_migrator;

grant gioia_mutator to postgres;
grant gioia_migrator to postgres;

alter default privileges for role postgres in schema gioia_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema gioia_private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema gioia_private
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role gioia_mutator in schema gioia_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role gioia_mutator in schema gioia_private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role gioia_mutator
  revoke execute on functions from public;
alter default privileges for role gioia_mutator in schema gioia_private
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role gioia_migrator in schema gioia_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role gioia_migrator in schema gioia_private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role gioia_migrator
  revoke execute on functions from public;
alter default privileges for role gioia_migrator in schema gioia_private
  revoke execute on functions from public, anon, authenticated, service_role;

revoke gioia_mutator from postgres;
revoke gioia_migrator from postgres;

revoke create on schema public from public;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname in ('btree_gist', 'citext', 'pgcrypto')
      and namespace.nspname <> 'extensions'
  ) then
    raise exception 'Required extensions must be installed in the extensions schema';
  end if;
end
$$;

create or replace function gioia_private.set_updated_at_and_version()
returns trigger
language plpgsql
set search_path = pg_catalog, gioia_private, extensions
as $$
begin
  new.created_at := old.created_at;
  new.updated_at := statement_timestamp();
  new.version := old.version + 1;
  return new;
end;
$$;

revoke all on function gioia_private.set_updated_at_and_version() from public;
revoke all on function gioia_private.set_updated_at_and_version() from anon;
revoke all on function gioia_private.set_updated_at_and_version() from authenticated;
revoke all on function gioia_private.set_updated_at_and_version() from service_role;
revoke all on function gioia_private.set_updated_at_and_version() from app_runtime;

commit;
