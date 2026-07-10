import {
  GREENFIELD_EXPECTED_ROLE_NAMES,
  GREENFIELD_EXPECTED_SCHEMA_NAMES,
} from "./test-target-fixture-sql.mjs";
import { GREENFIELD_REFERENCE_CHECKSUM } from "./test-target-fingerprint-sql.mjs";
import {
  GREENFIELD_BASELINE_VERSIONS,
  GREENFIELD_TARGET_VERSIONS,
} from "./test-target-migrations.mjs";

const words = (value) => Object.freeze(value.split(" "));
const CUSTOM_ROLES = words("app_runtime gioia_migrator gioia_mutator");
const REFERENCE_TABLES = words(
  "booking_policy business_hours service_categories service_variants services",
);
const BASELINE_TABLES = Object.freeze(
  [
    ...REFERENCE_TABLES,
    ..."command_requests domain_change_log email_outbox email_webhook_events migration_quarantine migration_records migration_runs newsletter_subscribers owner_accounts schedule_day_locks schedule_entries vacations".split(
      " ",
    ),
  ].sort(),
);
const TARGET_TABLES = Object.freeze(
  [...BASELINE_TABLES, "owner_sessions"].sort(),
);
const AUTH_TABLES = words(
  "audit_log_entries custom_oauth_providers flow_state identities instances mfa_amr_claims mfa_challenges mfa_factors oauth_authorizations oauth_client_states oauth_clients oauth_consents one_time_tokens refresh_tokens saml_providers saml_relay_states sessions sso_domains sso_providers users webauthn_challenges webauthn_credentials",
);
const STORAGE_TABLES = words(
  "buckets buckets_analytics buckets_vectors objects s3_multipart_uploads s3_multipart_uploads_parts vector_indexes",
);

function literal(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function textArray(values) {
  return `array[${values.map(literal).join(",")}]::text[]`;
}

export const GREENFIELD_REBUILD_GUARD_SQL = `
do $guard$
declare
  actual_versions text[]; actual_tables text[]; actual_roles text[];
  actual_schemas text[]; expected_tables text[]; table_name text;
  row_total bigint; reference_checksum text;
begin
  if current_user <> 'postgres' then
    raise exception 'Greenfield TEST rebuild requires postgres';
  end if;
  if pg_catalog.pg_try_advisory_xact_lock(7102026, 72135538) then
    raise exception 'Greenfield TEST advisory lock is not held by the lock session';
  end if;

  select coalesce(pg_catalog.array_agg(version::text order by version::text), '{}')
    into actual_versions from supabase_migrations.schema_migrations;
  if actual_versions = ${textArray(GREENFIELD_BASELINE_VERSIONS)} then
    expected_tables := ${textArray(BASELINE_TABLES)};
  elsif actual_versions = ${textArray(GREENFIELD_TARGET_VERSIONS)} then
    expected_tables := ${textArray(TARGET_TABLES)};
  else
    raise exception 'Greenfield TEST migration history is not an exact rebuild state';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations
      where name is null or octet_length(name) not between 1 and 255 or
        created_by is null or
        octet_length(created_by) not between 3 and 320 or
        cardinality(statements)<>1 or idempotency_key is not null or
        rollback is not null) or
     (select count(distinct created_by) from supabase_migrations.schema_migrations)<>1 then
    raise exception 'Greenfield TEST migration history metadata is not exact';
  end if;

  select coalesce(pg_catalog.array_agg(c.relname::text order by c.relname), '{}')
    into actual_tables from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='gioia_private' and c.relkind in ('r','p');
  if actual_tables <> expected_tables then
    raise exception 'Greenfield TEST private tables are not exact';
  end if;
  select pg_catalog.array_agg(rolname::text order by rolname) into actual_roles from pg_catalog.pg_roles;
  select pg_catalog.array_agg(nspname::text order by nspname) into actual_schemas from pg_catalog.pg_namespace
    where nspname !~ '^pg_temp_' and nspname !~ '^pg_toast_temp_';
  if actual_roles <> ${textArray(GREENFIELD_EXPECTED_ROLE_NAMES)} or
     actual_schemas <> ${textArray(GREENFIELD_EXPECTED_SCHEMA_NAMES)} then
    raise exception 'Greenfield TEST managed catalog is not exact';
  end if;

  if exists (select 1 from pg_catalog.pg_roles r
    where r.rolname=any(${textArray(CUSTOM_ROLES)}) and
      (r.rolcanlogin or r.rolsuper or r.rolcreatedb or r.rolcreaterole or
       r.rolinherit or r.rolreplication or r.rolbypassrls or r.rolconnlimit <> -1 or
       (r.rolname='app_runtime' and r.rolvaliduntil is not null and
         r.rolvaliduntil<>'infinity'::timestamptz) or
       (r.rolname<>'app_runtime' and r.rolvaliduntil is not null) or
       (select pg_catalog.array_agg(setting order by setting)
          from pg_catalog.unnest(coalesce(r.rolconfig,'{}')) as config(setting))
        is distinct from case r.rolname when 'gioia_migrator'
          then array['lock_timeout=5s','statement_timeout=5min']::text[]
          else array['lock_timeout=3s','statement_timeout=10s']::text[] end)) then
    raise exception 'Greenfield TEST custom role attributes are not exact';
  end if;
  if (select count(*) from pg_catalog.pg_auth_members m
      join pg_catalog.pg_roles granted on granted.oid=m.roleid
      join pg_catalog.pg_roles member on member.oid=m.member
      join pg_catalog.pg_roles grantor on grantor.oid=m.grantor
      where granted.rolname=any(${textArray(CUSTOM_ROLES)}) or
        member.rolname=any(${textArray(CUSTOM_ROLES)})) <> 3 or
     exists (select 1 from pg_catalog.pg_auth_members m
      join pg_catalog.pg_roles granted on granted.oid=m.roleid
      join pg_catalog.pg_roles member on member.oid=m.member
      join pg_catalog.pg_roles grantor on grantor.oid=m.grantor
      where (granted.rolname=any(${textArray(CUSTOM_ROLES)}) or
        member.rolname=any(${textArray(CUSTOM_ROLES)})) and
        (granted.rolname<>all(${textArray(CUSTOM_ROLES)}) or member.rolname<>'postgres' or
         grantor.rolname<>'supabase_admin' or not m.admin_option or
         m.inherit_option or m.set_option)) then
    raise exception 'Greenfield TEST custom role memberships are not exact';
  end if;
  if (select count(*) from pg_catalog.pg_default_acl d join pg_catalog.pg_roles r
      on r.oid=d.defaclrole where r.rolname=any(${textArray(CUSTOM_ROLES)})) <> 2 or
     (select count(*) from pg_catalog.pg_default_acl d join pg_catalog.pg_roles r
      on r.oid=d.defaclrole cross join lateral pg_catalog.aclexplode(d.defaclacl) a
      where r.rolname=any(${textArray(CUSTOM_ROLES)})) <> 2 or
     exists (select 1 from pg_catalog.pg_default_acl d join pg_catalog.pg_roles r
      on r.oid=d.defaclrole cross join lateral pg_catalog.aclexplode(d.defaclacl) a
      where r.rolname=any(${textArray(CUSTOM_ROLES)}) and
       (r.rolname not in ('gioia_migrator','gioia_mutator') or d.defaclnamespace<>0 or
        d.defaclobjtype<>'f' or a.grantee<>r.oid or a.grantor<>r.oid or
        a.privilege_type<>'EXECUTE' or a.is_grantable)) then
    raise exception 'Greenfield TEST custom default privileges are not exact';
  end if;
  if exists (select 1 from pg_catalog.pg_default_acl
      where defaclnamespace='gioia_private'::regnamespace) then
    raise exception 'Greenfield TEST has schema-scoped private default privileges';
  end if;
  if not exists (select 1 from pg_catalog.pg_namespace n join pg_catalog.pg_roles r
      on r.oid=n.nspowner where n.nspname='gioia_private' and r.rolname='postgres') or
     (select count(*) from pg_catalog.pg_namespace n
      cross join lateral pg_catalog.aclexplode(n.nspacl) a
      where n.nspname='gioia_private') <> 5 or
     exists (select 1 from pg_catalog.pg_namespace n
      cross join lateral pg_catalog.aclexplode(n.nspacl) a
      left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
      join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
      where n.nspname='gioia_private' and
       (grantor.rolname<>'postgres' or a.is_grantable or not (
        (coalesce(grantee.rolname,'PUBLIC')='postgres' and a.privilege_type in ('USAGE','CREATE')) or
        (coalesce(grantee.rolname,'PUBLIC') in ('app_runtime','gioia_migrator','gioia_mutator')
          and a.privilege_type='USAGE')))) then
    raise exception 'Greenfield TEST private schema ACL is not exact';
  end if;

  if (select count(*) from pg_catalog.pg_extension e join pg_catalog.pg_namespace n
      on n.oid=e.extnamespace where e.extname in ('btree_gist','citext','pgcrypto')
      and n.nspname='extensions') <> 3 or
     exists (select 1 from pg_catalog.pg_extension e join pg_catalog.pg_namespace n
      on n.oid=e.extnamespace join pg_catalog.pg_roles r on r.oid=e.extowner
      where n.nspname='gioia_private' or r.rolname=any(${textArray(CUSTOM_ROLES)})) then
    raise exception 'Greenfield TEST required extensions are not exact';
  end if;
  if exists (select 1 from pg_catalog.pg_stat_activity where pid<>pg_catalog.pg_backend_pid()
      and datname=pg_catalog.current_database() and
      (usename='app_runtime' or application_name='gioia_public_api')) then
    raise exception 'Greenfield TEST application sessions are active';
  end if;
  if exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n
      on n.oid=c.relnamespace where n.nspname='public') or
     exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n
      on n.oid=p.pronamespace where n.nspname='public') or
     exists (select 1 from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public') then
    raise exception 'Greenfield TEST public schema is not empty';
  end if;

  foreach table_name in array expected_tables loop
    if table_name<>all(${textArray(REFERENCE_TABLES)}) then
      execute pg_catalog.format('select count(*) from gioia_private.%I',table_name) into row_total;
      if row_total<>0 then raise exception 'Greenfield TEST operational residue exists'; end if;
    end if;
  end loop;
  foreach table_name in array ${textArray(AUTH_TABLES)} loop
    execute pg_catalog.format('select count(*) from auth.%I',table_name) into row_total;
    if row_total<>0 then raise exception 'Greenfield TEST Auth residue exists'; end if;
  end loop;
  foreach table_name in array ${textArray(STORAGE_TABLES)} loop
    execute pg_catalog.format('select count(*) from storage.%I',table_name) into row_total;
    if row_total<>0 then raise exception 'Greenfield TEST Storage residue exists'; end if;
  end loop;
  if (select count(*) from gioia_private.service_categories)<>12 or
     (select count(*) from gioia_private.services)<>74 or
     (select count(*) from gioia_private.service_variants)<>102 or
     (select count(*) from gioia_private.business_hours)<>5 or
     (select count(*) from gioia_private.booking_policy)<>1 then
    raise exception 'Greenfield TEST reference row counts are not exact';
  end if;
  select pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_object(
    'categories',(select jsonb_agg(to_jsonb(x)-'created_at'-'updated_at' order by id) from gioia_private.service_categories x), 'services',(select jsonb_agg(to_jsonb(x)-'created_at'-'updated_at' order by id) from gioia_private.services x),
    'variants',(select jsonb_agg(to_jsonb(x)-'created_at'-'updated_at' order by service_id,id) from gioia_private.service_variants x), 'hours',(select jsonb_agg(to_jsonb(x)-'created_at'-'updated_at' order by weekday) from gioia_private.business_hours x),
    'policy',(select jsonb_agg(to_jsonb(x)-'created_at'-'updated_at' order by singleton) from gioia_private.booking_policy x)
  )::text,'sha256'),'hex') into reference_checksum;
  if reference_checksum<>${literal(GREENFIELD_REFERENCE_CHECKSUM)} then
    raise exception 'Greenfield TEST reference checksum is not exact';
  end if;

  if exists (with recursive private_relations as (select c.oid from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='gioia_private'),
    private_seeds(classid,objid) as (
      select 'pg_catalog.pg_namespace'::regclass::oid,n.oid from pg_catalog.pg_namespace n where n.nspname='gioia_private'
      union select 'pg_catalog.pg_class'::regclass::oid,oid from private_relations
      union select 'pg_catalog.pg_proc'::regclass::oid,p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='gioia_private'
      union select 'pg_catalog.pg_type'::regclass::oid,t.oid from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace where n.nspname='gioia_private'
      union select 'pg_catalog.pg_constraint'::regclass::oid,c.oid from pg_catalog.pg_constraint c where c.connamespace='gioia_private'::regnamespace or c.conrelid in(select oid from private_relations)
      union select 'pg_catalog.pg_attrdef'::regclass::oid,a.oid from pg_catalog.pg_attrdef a where a.adrelid in(select oid from private_relations) union select 'pg_catalog.pg_rewrite'::regclass::oid,r.oid from pg_catalog.pg_rewrite r where r.ev_class in(select oid from private_relations)
      union select 'pg_catalog.pg_trigger'::regclass::oid,t.oid from pg_catalog.pg_trigger t where t.tgrelid in(select oid from private_relations) union select 'pg_catalog.pg_policy'::regclass::oid,p.oid from pg_catalog.pg_policy p where p.polrelid in(select oid from private_relations)
    ), private_drop_closure(classid,objid) as (
      select classid,objid from private_seeds
      union
      select d.classid,d.objid from pg_catalog.pg_depend d join private_drop_closure owned
        on owned.classid=d.refclassid and owned.objid=d.refobjid
      where d.deptype='i' or (d.deptype='a' and d.classid='pg_catalog.pg_class'::regclass
        and exists (select 1 from pg_catalog.pg_class idx join pg_catalog.pg_namespace n
          on n.oid=idx.relnamespace join pg_catalog.pg_index i on i.indexrelid=idx.oid
          where idx.oid=d.objid and n.nspname='pg_toast' and idx.relkind='i'
            and i.indrelid=d.refobjid))
    ) select 1 from pg_catalog.pg_depend d join private_drop_closure ref
      on ref.classid=d.refclassid and ref.objid=d.refobjid left join private_drop_closure owned
      on owned.classid=d.classid and owned.objid=d.objid where owned.objid is null) then
    raise exception 'Greenfield TEST has external dependencies on private objects';
  end if;
end
$guard$`;
