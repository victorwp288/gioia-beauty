const MANAGED_SCHEMAS = Object.freeze([
  "auth",
  "extensions",
  "graphql",
  "graphql_public",
  "pgbouncer",
  "public",
  "realtime",
  "storage",
  "supabase_migrations",
  "vault",
]);

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const textArray = (values) => `array[${values.map(literal).join(",")}]::text[]`;
const SCHEMAS_SQL = textArray(MANAGED_SCHEMAS);

export const GREENFIELD_PRISTINE_BASELINE_EVIDENCE = Object.freeze({
  catalogFingerprint:
    "da4e0fd1681a96db8329447303cfe07485066d50d649e1fbf4d6c793f3debddd",
  manifestRows: 2649,
  roleCount: 30,
  membershipCount: 21,
  schemaCount: 9,
  extensionCount: 5,
  relationCount: 159,
  routineCount: 98,
  triggerCount: 5,
  policyCount: 0,
  standaloneTypeCount: 12,
  defaultAclCount: 300,
});

// Run this read-only query against a newly-created hosted PG17 project to
// register its provider baseline. It returns only a SHA-256 and aggregate
// counts; no object definitions, credentials, or row data leave PostgreSQL.
export const GREENFIELD_PRISTINE_BASELINE_EVIDENCE_SQL = `
with manifest as (
  select 'database'::text kind, current_database()::text identity,
    pg_catalog.concat_ws('|', owner.rolname, d.datconnlimit::text,
      d.datallowconn::text, d.datistemplate::text) definition
  from pg_catalog.pg_database d
  join pg_catalog.pg_roles owner on owner.oid=d.datdba
  where d.datname=current_database()
  union all
  select 'database_acl',d.datname||'.'||coalesce(grantee.rolname,'PUBLIC')||'.'||a.privilege_type,
    pg_catalog.concat_ws('|',coalesce(grantor.rolname,'PUBLIC'),a.is_grantable::text)
  from pg_catalog.pg_database d
  cross join lateral pg_catalog.aclexplode(d.datacl) a
  left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
  left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
  where d.datname=current_database()
  union all
  select 'database_setting',d.datname||'.'||coalesce(r.rolname,'*')||'.'||setting,
    ''
  from pg_catalog.pg_db_role_setting s
  join pg_catalog.pg_database d on d.oid=s.setdatabase
  left join pg_catalog.pg_roles r on r.oid=s.setrole
  cross join lateral pg_catalog.unnest(s.setconfig) as config(setting)
  where d.datname=current_database()
  union all
  select 'role', r.rolname,
    pg_catalog.concat_ws('|', r.rolsuper::text, r.rolinherit::text,
      r.rolcreaterole::text, r.rolcreatedb::text, r.rolcanlogin::text,
      r.rolreplication::text, r.rolconnlimit::text,
      coalesce(r.rolvaliduntil::text,''), r.rolbypassrls::text,
      coalesce((select pg_catalog.array_agg(setting order by setting)::text
        from pg_catalog.unnest(coalesce(r.rolconfig,'{}')) as config(setting)),''),
      case when a.rolpassword is null then 'none'
        when a.rolpassword like 'SCRAM-SHA-256$%' then 'scram'
        else 'other' end)
  from pg_catalog.pg_roles r
  join pg_catalog.pg_authid a on a.oid=r.oid
  union all
  select 'role_membership', granted.rolname||'>'||member.rolname,
    pg_catalog.concat_ws('|', grantor.rolname, m.admin_option::text,
      m.inherit_option::text, m.set_option::text)
  from pg_catalog.pg_auth_members m
  join pg_catalog.pg_roles granted on granted.oid=m.roleid
  join pg_catalog.pg_roles member on member.oid=m.member
  join pg_catalog.pg_roles grantor on grantor.oid=m.grantor
  union all
  select 'schema', n.nspname, owner.rolname
  from pg_catalog.pg_namespace n
  join pg_catalog.pg_roles owner on owner.oid=n.nspowner
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'schema_acl', n.nspname||'.'||coalesce(grantee.rolname,'PUBLIC')||'.'||a.privilege_type,
    pg_catalog.concat_ws('|',coalesce(grantor.rolname,'PUBLIC'),a.is_grantable::text)
  from pg_catalog.pg_namespace n
  cross join lateral pg_catalog.aclexplode(n.nspacl) a
  left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
  left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'default_acl', owner.rolname||'.'||coalesce(n.nspname,'*')||'.'||d.defaclobjtype::text||'.'||
      coalesce(grantee.rolname,'PUBLIC')||'.'||a.privilege_type,
    pg_catalog.concat_ws('|',coalesce(grantor.rolname,'PUBLIC'),a.is_grantable::text)
  from pg_catalog.pg_default_acl d
  join pg_catalog.pg_roles owner on owner.oid=d.defaclrole
  left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
  cross join lateral pg_catalog.aclexplode(d.defaclacl) a
  left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
  left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
  union all
  select 'extension', e.extname,
    pg_catalog.concat_ws('|',owner.rolname,n.nspname,e.extversion,
      e.extrelocatable::text,coalesce(e.extconfig::text,''),
      coalesce(e.extcondition::text,''))
  from pg_catalog.pg_extension e
  join pg_catalog.pg_roles owner on owner.oid=e.extowner
  join pg_catalog.pg_namespace n on n.oid=e.extnamespace
  union all
  select 'relation', n.nspname||'.'||c.relname,
    pg_catalog.concat_ws('|',owner.rolname,c.relkind::text,
      c.relpersistence::text,c.relrowsecurity::text,
      c.relforcerowsecurity::text,c.relreplident::text)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_roles owner on owner.oid=c.relowner
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'relation_acl', n.nspname||'.'||c.relname||'.'||
      coalesce(grantee.rolname,'PUBLIC')||'.'||a.privilege_type,
    pg_catalog.concat_ws('|',coalesce(grantor.rolname,'PUBLIC'),a.is_grantable::text)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  cross join lateral pg_catalog.aclexplode(c.relacl) a
  left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
  left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'column', n.nspname||'.'||c.relname||'.'||a.attname,
    pg_catalog.concat_ws('|',pg_catalog.format_type(a.atttypid,a.atttypmod),
      a.attnotnull::text,coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid),''),
      a.attidentity::text,a.attgenerated::text,
      coalesce(coll.collname,''))
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid=a.attrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  left join pg_catalog.pg_collation coll on coll.oid=a.attcollation
  where n.nspname=any(${SCHEMAS_SQL}) and a.attnum>0 and not a.attisdropped
  union all
  select 'column_acl', n.nspname||'.'||c.relname||'.'||attr.attname||'.'||
      coalesce(grantee.rolname,'PUBLIC')||'.'||a.privilege_type,
    pg_catalog.concat_ws('|',coalesce(grantor.rolname,'PUBLIC'),a.is_grantable::text)
  from pg_catalog.pg_attribute attr
  join pg_catalog.pg_class c on c.oid=attr.attrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  cross join lateral pg_catalog.aclexplode(attr.attacl) a
  left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
  left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
  where n.nspname=any(${SCHEMAS_SQL}) and attr.attnum>0 and not attr.attisdropped
  union all
  select 'constraint', n.nspname||'.'||coalesce(c.relname,'*')||'.'||con.conname,
    pg_catalog.concat_ws('|',con.contype::text,con.condeferrable::text,
      con.condeferred::text,con.convalidated::text,
      pg_catalog.pg_get_constraintdef(con.oid,true))
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_namespace n on n.oid=con.connamespace
  left join pg_catalog.pg_class c on c.oid=con.conrelid
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'index', n.nspname||'.'||c.relname,
    pg_catalog.concat_ws('|',i.indisunique::text,i.indisprimary::text,
      i.indisexclusion::text,i.indisvalid::text,
      pg_catalog.pg_get_indexdef(i.indexrelid))
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid=i.indexrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'view', n.nspname||'.'||c.relname,
    pg_catalog.pg_get_viewdef(c.oid,true)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname=any(${SCHEMAS_SQL}) and c.relkind in ('v','m')
  union all
  select 'sequence', n.nspname||'.'||c.relname,
    pg_catalog.concat_ws('|',pg_catalog.format_type(s.seqtypid,null),
      s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,
      s.seqcache::text,s.seqcycle::text)
  from pg_catalog.pg_sequence s
  join pg_catalog.pg_class c on c.oid=s.seqrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'routine', n.nspname||'.'||p.proname||'('||
      pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
    pg_catalog.concat_ws('|',owner.rolname,p.prokind::text,p.provolatile::text,
      p.prosecdef::text,p.proleakproof::text,p.proparallel::text,
      coalesce(p.proconfig::text,''),
      case when p.prokind='a' then pg_catalog.concat_ws('|',
        pg_catalog.pg_get_function_arguments(p.oid),
        pg_catalog.pg_get_function_result(p.oid))
      else pg_catalog.pg_get_functiondef(p.oid) end)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_roles owner on owner.oid=p.proowner
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'routine_acl', n.nspname||'.'||p.proname||'('||
      pg_catalog.pg_get_function_identity_arguments(p.oid)||').'||
      coalesce(grantee.rolname,'PUBLIC')||'.'||a.privilege_type,
    pg_catalog.concat_ws('|',coalesce(grantor.rolname,'PUBLIC'),a.is_grantable::text)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  cross join lateral pg_catalog.aclexplode(p.proacl) a
  left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
  left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'trigger', n.nspname||'.'||c.relname||'.'||t.tgname,
    pg_catalog.pg_get_triggerdef(t.oid,true)
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname=any(${SCHEMAS_SQL}) and not t.tgisinternal
  union all
  select 'policy', n.nspname||'.'||c.relname||'.'||p.polname,
    pg_catalog.concat_ws('|',p.polcmd::text,p.polpermissive::text,
      (select pg_catalog.array_agg(role.rolname order by role.rolname)::text
        from pg_catalog.unnest(p.polroles) member(role_oid)
        join pg_catalog.pg_roles role on role.oid=member.role_oid),
      coalesce(pg_catalog.pg_get_expr(p.polqual,p.polrelid),''),
      coalesce(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_catalog.pg_policy p
  join pg_catalog.pg_class c on c.oid=p.polrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'standalone_type', n.nspname||'.'||t.typname,
    pg_catalog.concat_ws('|',owner.rolname,t.typtype::text,t.typcategory::text,
      t.typnotnull::text,coalesce(pg_catalog.format_type(t.typbasetype,t.typtypmod),''),
      coalesce(t.typdefault,''),
      coalesce((select pg_catalog.jsonb_agg(e.enumlabel order by e.enumsortorder)::text
        from pg_catalog.pg_enum e where e.enumtypid=t.oid),''),
      coalesce(pg_catalog.format_type(r.rngsubtype,null),''))
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid=t.typnamespace
  join pg_catalog.pg_roles owner on owner.oid=t.typowner
  left join pg_catalog.pg_range r on r.rngtypid=t.oid
  where n.nspname=any(${SCHEMAS_SQL}) and t.typelem=0 and
    not exists (select 1 from pg_catalog.pg_class c where c.reltype=t.oid)
  union all
  select 'type_acl', n.nspname||'.'||t.typname||'.'||
      coalesce(grantee.rolname,'PUBLIC')||'.'||a.privilege_type,
    pg_catalog.concat_ws('|',coalesce(grantor.rolname,'PUBLIC'),a.is_grantable::text)
  from pg_catalog.pg_type t
  join pg_catalog.pg_namespace n on n.oid=t.typnamespace
  cross join lateral pg_catalog.aclexplode(t.typacl) a
  left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
  left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
  where n.nspname=any(${SCHEMAS_SQL})
  union all
  select 'event_trigger', e.evtname,
    pg_catalog.concat_ws('|',owner.rolname,e.evtevent,e.evtenabled,
      e.evttags::text,p.proname)
  from pg_catalog.pg_event_trigger e
  join pg_catalog.pg_roles owner on owner.oid=e.evtowner
  join pg_catalog.pg_proc p on p.oid=e.evtfoid
  union all
  select 'publication', p.pubname,
    pg_catalog.concat_ws('|',owner.rolname,p.puballtables::text,
      p.pubinsert::text,p.pubupdate::text,p.pubdelete::text,p.pubtruncate::text,
      p.pubviaroot::text)
  from pg_catalog.pg_publication p
  join pg_catalog.pg_roles owner on owner.oid=p.pubowner
  union all
  select 'publication_relation',p.pubname||'.'||n.nspname||'.'||c.relname,
    coalesce(pg_catalog.pg_get_expr(pr.prqual,pr.prrelid),'')
  from pg_catalog.pg_publication_rel pr
  join pg_catalog.pg_publication p on p.oid=pr.prpubid
  join pg_catalog.pg_class c on c.oid=pr.prrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
), normalized as (
  select kind,identity,definition from manifest
  order by kind,identity,definition
)
select
  pg_catalog.encode(extensions.digest(coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('kind',kind,'identity',identity,
      'definition',definition) order by kind,identity,definition),'[]'::jsonb)::text,
    'sha256'),'hex') as catalog_fingerprint,
  count(*)::integer as manifest_rows,
  count(*) filter (where kind='role')::integer as role_count,
  count(*) filter (where kind='role_membership')::integer as membership_count,
  count(*) filter (where kind='schema')::integer as schema_count,
  count(*) filter (where kind='extension')::integer as extension_count,
  count(*) filter (where kind='relation')::integer as relation_count,
  count(*) filter (where kind='routine')::integer as routine_count,
  count(*) filter (where kind='trigger')::integer as trigger_count,
  count(*) filter (where kind='policy')::integer as policy_count,
  count(*) filter (where kind='standalone_type')::integer as standalone_type_count,
  count(*) filter (where kind='default_acl')::integer as default_acl_count
from normalized
`;

const EVIDENCE_FIELDS = Object.freeze([
  ["manifest_rows", "manifestRows"],
  ["role_count", "roleCount"],
  ["membership_count", "membershipCount"],
  ["schema_count", "schemaCount"],
  ["extension_count", "extensionCount"],
  ["relation_count", "relationCount"],
  ["routine_count", "routineCount"],
  ["trigger_count", "triggerCount"],
  ["policy_count", "policyCount"],
  ["standalone_type_count", "standaloneTypeCount"],
  ["default_acl_count", "defaultAclCount"],
]);

export function assertGreenfieldPristineBaselineEvidence(row) {
  if (
    row?.catalog_fingerprint !==
      GREENFIELD_PRISTINE_BASELINE_EVIDENCE.catalogFingerprint ||
    EVIDENCE_FIELDS.some(([field, expectedField]) => {
      const value = Number(row?.[field]);
      return (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value !== GREENFIELD_PRISTINE_BASELINE_EVIDENCE[expectedField]
      );
    })
  ) {
    throw new Error("Greenfield TEST hosted provider catalog is not pristine");
  }
  return true;
}
