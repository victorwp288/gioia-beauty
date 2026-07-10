begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;
grant usage on schema auth to gioia_mutator;
grant execute on function auth.uid() to gioia_mutator;

set local role gioia_mutator;

create or replace function gioia_private.assert_enabled_owner(p_user_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_authenticated_user_id uuid := auth.uid();
begin
  if v_authenticated_user_id is null then
    raise sqlstate 'PT401' using message = 'OWNER_AUTHENTICATION_REQUIRED';
  end if;

  if p_user_id is distinct from v_authenticated_user_id then
    raise sqlstate 'PT403' using message = 'OWNER_IDENTITY_MISMATCH';
  end if;

  if not exists (
    select 1
    from gioia_private.owner_accounts as owner
    where owner.user_id = v_authenticated_user_id
      and owner.role = 'owner'
      and owner.enabled
  ) then
    raise sqlstate 'PT403' using message = 'OWNER_AUTHORIZATION_REQUIRED';
  end if;
end;
$$;

revoke all on function gioia_private.assert_enabled_owner(uuid)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.assert_enabled_owner(uuid) to gioia_mutator;

create function gioia_private.authorize_owner_session(p_actor_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  return true;
end;
$$;

revoke all on function gioia_private.authorize_owner_session(uuid)
  from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.authorize_owner_session(uuid)
  to app_runtime;

reset role;

revoke create on schema gioia_private from gioia_mutator;
revoke gioia_mutator from postgres;

commit;
