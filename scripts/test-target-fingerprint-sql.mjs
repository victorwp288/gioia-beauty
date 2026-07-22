export const GREENFIELD_REFERENCE_CHECKSUM =
  "d54690cdf5617fdcc00ce36e5fa326a84179474f64c230abc23f8caa6b90473e";
export const GREENFIELD_SCHEMA_FINGERPRINT =
  "32fe2c303f4cde175c46c35c51e896625cb89c53ec907bea2fd8deb1cdd74af8";

export const GREENFIELD_FINGERPRINT_SQL = `
  with private_objects as (
    select 'schema'::text as kind, n.nspname::text as identity,
      pg_catalog.concat_ws('|', owner.rolname, coalesce(n.nspacl::text, ''))
        as definition
    from pg_catalog.pg_namespace n
    join pg_catalog.pg_roles owner on owner.oid = n.nspowner
    where n.nspname = 'gioia_private'
    union all
    select 'relation', c.relname,
      pg_catalog.concat_ws('|', owner.rolname, c.relkind::text,
        c.relpersistence::text,
        c.relrowsecurity::text, c.relforcerowsecurity::text,
        c.relreplident::text, coalesce(c.relacl::text, ''))
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_roles owner on owner.oid = c.relowner
    where n.nspname = 'gioia_private'
    union all
    select 'sequence', s.sequencename,
      pg_catalog.concat_ws('|', s.data_type::text, s.start_value::text,
        s.increment_by::text, s.min_value::text, s.max_value::text,
        s.cache_size::text, s.cycle::text)
    from pg_catalog.pg_sequences s
    where s.schemaname = 'gioia_private'
    union all
    select 'column', c.relname || '.' || a.attname,
      pg_catalog.concat_ws('|',
        pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull::text,
        coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''),
        a.attidentity::text, a.attgenerated::text,
        coalesce(a.attacl::text, ''))
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'gioia_private' and a.attnum > 0 and not a.attisdropped
    union all
    select 'constraint', c.relname || '.' || con.conname,
      pg_catalog.concat_ws('|', con.contype::text, con.condeferrable::text,
        con.condeferred::text, con.convalidated::text,
        pg_catalog.pg_get_constraintdef(con.oid, true))
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'gioia_private'
    union all
    select 'index', c.relname,
      pg_catalog.concat_ws('|', i.indisunique::text, i.indisprimary::text,
        i.indisexclusion::text, i.indisvalid::text,
        pg_catalog.pg_get_indexdef(i.indexrelid))
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'gioia_private'
    union all
    select 'function', p.proname || '(' ||
        pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
      pg_catalog.concat_ws('|', owner.rolname, p.prokind::text,
        p.provolatile::text,
        p.prosecdef::text, p.proleakproof::text, p.proparallel::text,
        coalesce(p.proconfig::text, ''),
        coalesce(p.proacl::text, ''),
        pg_catalog.pg_get_functiondef(p.oid))
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_roles owner on owner.oid = p.proowner
    where n.nspname = 'gioia_private'
    union all
    select 'trigger', c.relname || '.' || t.tgname,
      pg_catalog.pg_get_triggerdef(t.oid, true)
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'gioia_private' and not t.tgisinternal
    union all
    select 'policy', c.relname || '.' || p.polname,
      pg_catalog.concat_ws('|', p.polcmd::text, p.polpermissive::text,
        (select pg_catalog.array_agg(role.rolname order by role.rolname)::text
          from pg_catalog.unnest(p.polroles) as member(role_oid)
          join pg_catalog.pg_roles role on role.oid = member.role_oid),
        coalesce(pg_catalog.pg_get_expr(
          p.polqual, p.polrelid), ''),
        coalesce(pg_catalog.pg_get_expr(
          p.polwithcheck, p.polrelid), ''))
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'gioia_private'
    union all
    select 'standalone_type', t.typname,
      pg_catalog.concat_ws('|', owner.rolname, t.typtype::text,
        t.typcategory::text, t.typnotnull::text,
        coalesce(pg_catalog.format_type(t.typbasetype, t.typtypmod), ''),
        coalesce(t.typdefault, ''),
        coalesce((select pg_catalog.jsonb_agg(e.enumlabel
          order by e.enumsortorder)::text
          from pg_catalog.pg_enum e where e.enumtypid = t.oid), ''),
        coalesce(pg_catalog.format_type(r.rngsubtype, null), ''))
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    join pg_catalog.pg_roles owner on owner.oid = t.typowner
    left join pg_catalog.pg_range r on r.rngtypid = t.oid
    where n.nspname = 'gioia_private' and t.typelem = 0 and
      not exists (select 1 from pg_catalog.pg_class c where c.reltype = t.oid)
    union all
    select 'type_acl', t.typname || '.' ||
        coalesce(grantee.rolname, 'PUBLIC') || '.' || a.privilege_type,
      pg_catalog.concat_ws('|', coalesce(grantor.rolname, 'PUBLIC'),
        a.is_grantable::text)
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    cross join lateral pg_catalog.aclexplode(t.typacl) a
    left join pg_catalog.pg_roles grantee on grantee.oid = a.grantee
    left join pg_catalog.pg_roles grantor on grantor.oid = a.grantor
    where n.nspname = 'gioia_private' and t.typelem = 0 and
      not exists (select 1 from pg_catalog.pg_class c where c.reltype = t.oid)
  ), reference_state as (
    select pg_catalog.jsonb_build_object(
      'categories', coalesce((select jsonb_agg(
        to_jsonb(c) - 'created_at' - 'updated_at' order by c.id)
        from gioia_private.service_categories c), '[]'::jsonb),
      'services', coalesce((select jsonb_agg(
        to_jsonb(s) - 'created_at' - 'updated_at' order by s.id)
        from gioia_private.services s), '[]'::jsonb),
      'variants', coalesce((select jsonb_agg(
        to_jsonb(v) - 'created_at' - 'updated_at'
        order by v.service_id, v.id)
        from gioia_private.service_variants v), '[]'::jsonb),
      'hours', coalesce((select jsonb_agg(
        to_jsonb(h) - 'created_at' - 'updated_at' order by h.weekday)
        from gioia_private.business_hours h), '[]'::jsonb),
      'policy', coalesce((select jsonb_agg(
        to_jsonb(p) - 'created_at' - 'updated_at' order by p.singleton)
        from gioia_private.booking_policy p), '[]'::jsonb)
    ) as value
  )
  select
    (select pg_catalog.encode(extensions.digest(
      coalesce(jsonb_agg(pg_catalog.jsonb_build_object(
        'kind', kind, 'identity', identity, 'definition', definition)
        order by kind, identity), '[]'::jsonb)::text, 'sha256'), 'hex')
      from private_objects) as schema_fingerprint,
    (select pg_catalog.encode(extensions.digest(value::text, 'sha256'), 'hex')
      from reference_state) as reference_checksum,
    (select count(*)::integer from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public') as public_relations,
    (select count(*)::integer from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public') as public_functions,
    (select count(*)::integer from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public') as public_policies,
    (select count(*)::integer from pg_catalog.pg_extension
      where extname = 'pgtap') as test_extensions,
    (select count(*)::integer from auth.instances) as auth_instances
`;
