begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table gioia_private.owner_sessions (
  session_id uuid primary key,
  user_id uuid not null references gioia_private.owner_accounts(user_id)
    on update restrict on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint owner_sessions_expiry_after_creation
    check (expires_at > created_at),
  constraint owner_sessions_lifetime_bounded
    check (expires_at <= created_at + interval '12 hours'),
  constraint owner_sessions_revocation_after_creation
    check (revoked_at is null or revoked_at >= created_at)
);

create index owner_sessions_user_id_idx
  on gioia_private.owner_sessions (user_id);
create index owner_sessions_active_expiry_idx
  on gioia_private.owner_sessions (expires_at, session_id)
  where revoked_at is null;

alter table gioia_private.owner_sessions enable row level security;
alter table gioia_private.owner_sessions force row level security;

create policy owner_sessions_mutator_all on gioia_private.owner_sessions
  for all to gioia_mutator using (true) with check (true);

grant select, insert, update on table gioia_private.owner_sessions
  to gioia_mutator;
revoke all on table gioia_private.owner_sessions
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

drop function gioia_private.authorize_owner_session(uuid);

create function gioia_private.authenticated_owner_session_id(
  p_actor_user_id uuid
)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_claim text := nullif(
    pg_catalog.current_setting('request.jwt.claim.sub', true), ''
  );
  v_authenticated_user_id uuid;
  v_session_claim text := nullif(
    pg_catalog.current_setting('request.jwt.claim.session_id', true), ''
  );
  v_authenticated_session_id uuid;
begin
  if v_user_claim is null then
    raise sqlstate 'PT401' using message = 'OWNER_AUTHENTICATION_REQUIRED';
  end if;

  begin
    v_authenticated_user_id := v_user_claim::uuid;
  exception
    when invalid_text_representation then
      raise sqlstate 'PT401' using message = 'OWNER_AUTHENTICATION_REQUIRED';
  end;
  if v_session_claim is null then
    raise sqlstate 'PT401' using message = 'OWNER_SESSION_REQUIRED';
  end if;

  begin
    v_authenticated_session_id := v_session_claim::uuid;
  exception
    when invalid_text_representation then
      raise sqlstate 'PT401' using message = 'OWNER_SESSION_REQUIRED';
  end;

  if p_actor_user_id is distinct from v_authenticated_user_id then
    raise sqlstate 'PT403' using message = 'OWNER_IDENTITY_MISMATCH';
  end if;
  return v_authenticated_session_id;
end;
$$;

create function gioia_private.assert_enabled_owner_account(p_actor_user_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_actor_user_id is null or not exists (
    select 1
    from gioia_private.owner_accounts as owner
    where owner.user_id = p_actor_user_id
      and owner.role = 'owner'
      and owner.enabled
  ) then
    raise sqlstate 'PT403' using message = 'OWNER_AUTHORIZATION_REQUIRED';
  end if;
end;
$$;

create or replace function gioia_private.assert_enabled_owner(p_user_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_session_id uuid := gioia_private.authenticated_owner_session_id(p_user_id);
  v_session gioia_private.owner_sessions%rowtype;
begin
  perform gioia_private.assert_enabled_owner_account(p_user_id);

  select session.* into v_session
  from gioia_private.owner_sessions as session
  where session.session_id = v_session_id;

  if not found then
    raise sqlstate 'PT401' using message = 'OWNER_SESSION_REQUIRED';
  end if;
  if v_session.user_id <> p_user_id then
    raise sqlstate 'PT403' using message = 'OWNER_SESSION_MISMATCH';
  end if;
  if v_session.revoked_at is not null then
    raise sqlstate 'PT401' using message = 'OWNER_SESSION_REVOKED';
  end if;
  if v_session.expires_at <= pg_catalog.statement_timestamp() then
    raise sqlstate 'PT401' using message = 'OWNER_SESSION_EXPIRED';
  end if;
end;
$$;

create function gioia_private.start_owner_session(
  p_actor_user_id uuid,
  p_session_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_session gioia_private.owner_sessions%rowtype;
begin
  if p_session_id is distinct from
    gioia_private.authenticated_owner_session_id(p_actor_user_id) then
    raise sqlstate 'PT403' using message = 'OWNER_SESSION_MISMATCH';
  end if;
  perform gioia_private.assert_enabled_owner_account(p_actor_user_id);

  insert into gioia_private.owner_sessions (
    session_id, user_id, created_at, expires_at
  ) values (
    p_session_id, p_actor_user_id, v_now, v_now + interval '12 hours'
  )
  on conflict (session_id) do nothing;

  select session.* into strict v_session
  from gioia_private.owner_sessions as session
  where session.session_id = p_session_id
  for update;

  if v_session.user_id <> p_actor_user_id then
    raise sqlstate 'PT403' using message = 'OWNER_SESSION_MISMATCH';
  end if;
  if v_session.revoked_at is not null then
    raise sqlstate 'PT401' using message = 'OWNER_SESSION_REVOKED';
  end if;
  if v_session.expires_at <= v_now then
    raise sqlstate 'PT401' using message = 'OWNER_SESSION_EXPIRED';
  end if;
  return true;
end;
$$;

create function gioia_private.authorize_owner_session(
  p_actor_user_id uuid,
  p_session_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_session_id is distinct from
    gioia_private.authenticated_owner_session_id(p_actor_user_id) then
    raise sqlstate 'PT403' using message = 'OWNER_SESSION_MISMATCH';
  end if;
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  return true;
end;
$$;

create function gioia_private.revoke_owner_session(
  p_actor_user_id uuid,
  p_session_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_session gioia_private.owner_sessions%rowtype;
begin
  if p_session_id is distinct from
    gioia_private.authenticated_owner_session_id(p_actor_user_id) then
    raise sqlstate 'PT403' using message = 'OWNER_SESSION_MISMATCH';
  end if;

  if not exists (
    select 1 from gioia_private.owner_accounts as owner
    where owner.user_id = p_actor_user_id and owner.role = 'owner'
  ) then
    raise sqlstate 'PT403' using message = 'OWNER_AUTHORIZATION_REQUIRED';
  end if;

  insert into gioia_private.owner_sessions (
    session_id, user_id, created_at, expires_at, revoked_at
  ) values (
    p_session_id, p_actor_user_id, v_now, v_now + interval '12 hours', v_now
  )
  on conflict (session_id) do nothing;

  select session.* into strict v_session
  from gioia_private.owner_sessions as session
  where session.session_id = p_session_id
  for update;

  if v_session.user_id <> p_actor_user_id then
    raise sqlstate 'PT403' using message = 'OWNER_SESSION_MISMATCH';
  end if;
  if v_session.revoked_at is null then
    update gioia_private.owner_sessions as session
    set revoked_at = v_now
    where session.session_id = p_session_id;
  end if;
  return true;
end;
$$;

revoke all on function gioia_private.authenticated_owner_session_id(uuid)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.assert_enabled_owner_account(uuid)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.assert_enabled_owner(uuid)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.authenticated_owner_session_id(uuid)
  to gioia_mutator;
grant execute on function gioia_private.assert_enabled_owner_account(uuid)
  to gioia_mutator;
grant execute on function gioia_private.assert_enabled_owner(uuid) to gioia_mutator;

revoke all on function gioia_private.start_owner_session(uuid, uuid)
  from public, anon, authenticated, service_role, gioia_migrator;
revoke all on function gioia_private.authorize_owner_session(uuid, uuid)
  from public, anon, authenticated, service_role, gioia_migrator;
revoke all on function gioia_private.revoke_owner_session(uuid, uuid)
  from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.start_owner_session(uuid, uuid)
  to app_runtime;
grant execute on function gioia_private.authorize_owner_session(uuid, uuid)
  to app_runtime;
grant execute on function gioia_private.revoke_owner_session(uuid, uuid)
  to app_runtime;

reset role;

revoke create on schema gioia_private from gioia_mutator;
revoke gioia_mutator from postgres;

commit;
