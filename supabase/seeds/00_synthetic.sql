-- Local/CI seed entrypoint. Keep every row synthetic and deterministic.
-- Catalog reference data is versioned in migrations, not seeded here.
-- The fixture credential is public, local-only test data and must never be reused.

begin;

set time zone 'Europe/Rome';

do $seed$
declare
  v_owner_id constant uuid := '51000000-0000-4000-8000-000000000001';
  v_identity_id constant uuid := '52000000-0000-4000-8000-000000000001';
  v_email constant text := 'owner.local@gioia.test';
  v_created_at constant timestamptz := '2026-01-01 00:00:00+00';
  -- Fixed bcrypt hash for the public local-only fixture password.
  v_password_hash constant text :=
    '$2a$10$aUgpUXHA/xNJyVGpI0zIFOPgxDm6x4MtUR0ClfTYyCDANwCyEh5pm'; -- gitleaks:allow
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    raw_app_meta_data,
    raw_user_meta_data,
    is_anonymous,
    created_at,
    updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_owner_id,
    'authenticated',
    'authenticated',
    v_email,
    v_password_hash,
    v_created_at,
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false,
    v_created_at,
    v_created_at
  )
  on conflict (id) do update set
    instance_id = excluded.instance_id,
    aud = excluded.aud,
    role = excluded.role,
    email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    confirmation_token = excluded.confirmation_token,
    recovery_token = excluded.recovery_token,
    email_change_token_new = excluded.email_change_token_new,
    email_change = excluded.email_change,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    is_anonymous = excluded.is_anonymous,
    updated_at = excluded.updated_at;

  insert into auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    v_identity_id,
    v_owner_id::text,
    v_owner_id,
    pg_catalog.jsonb_build_object(
      'sub', v_owner_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    v_created_at,
    v_created_at,
    v_created_at
  )
  on conflict (provider_id, provider) do update set
    user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    last_sign_in_at = excluded.last_sign_in_at,
    updated_at = excluded.updated_at;

  insert into gioia_private.owner_accounts as owner_account (
    user_id,
    role,
    enabled,
    version,
    created_at,
    updated_at
  ) values (
    v_owner_id,
    'owner',
    true,
    1,
    v_created_at,
    v_created_at
  )
  on conflict (user_id) do update set
    role = excluded.role,
    enabled = excluded.enabled
  where (owner_account.role, owner_account.enabled)
    is distinct from (excluded.role, excluded.enabled);
end
$seed$;

commit;
