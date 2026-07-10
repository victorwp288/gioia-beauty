begin;

set local search_path = extensions, public, pg_catalog;

select plan(8);

select is(
  (
    select count(*)
    from auth.users
    where id = '51000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the deterministic synthetic Auth owner exists exactly once'
);

select is(
  (
    select count(*)
    from auth.users
    where id = '51000000-0000-4000-8000-000000000001'
      and instance_id = '00000000-0000-0000-0000-000000000000'
      and aud = 'authenticated'
      and role = 'authenticated'
      and email = 'owner.local@gioia.test'
      and email_confirmed_at is not null
      and confirmation_token = ''
      and recovery_token = ''
      and email_change_token_new = ''
      and email_change = ''
      and not is_anonymous
  ),
  1::bigint,
  'the synthetic Auth owner is confirmed and password-login eligible'
);

select is(
  (
    select count(*)
    from auth.users
    where id = '51000000-0000-4000-8000-000000000001'
      and encrypted_password ~ '^\$2[aby]\$10\$[./A-Za-z0-9]{53}$'
  ),
  1::bigint,
  'the synthetic password is stored only as a fixed bcrypt hash'
);

select is(
  (
    select count(*)
    from auth.users
    where id = '51000000-0000-4000-8000-000000000001'
      and raw_app_meta_data =
        '{"provider":"email","providers":["email"]}'::jsonb
      and raw_user_meta_data = '{}'::jsonb
  ),
  1::bigint,
  'the synthetic Auth metadata enables only the email provider'
);

select is(
  (
    select count(*)
    from auth.identities
    where id = '52000000-0000-4000-8000-000000000001'
      and provider_id = '51000000-0000-4000-8000-000000000001'
      and user_id = '51000000-0000-4000-8000-000000000001'
      and provider = 'email'
  ),
  1::bigint,
  'the synthetic owner has exactly one deterministic email identity'
);

select is(
  (
    select count(*)
    from auth.identities
    where id = '52000000-0000-4000-8000-000000000001'
      and identity_data ->> 'sub' =
        '51000000-0000-4000-8000-000000000001'
      and identity_data ->> 'email' = 'owner.local@gioia.test'
      and identity_data ->> 'email_verified' = 'true'
  ),
  1::bigint,
  'the email identity matches the synthetic Auth principal'
);

select is(
  (
    select count(*)
    from gioia_private.owner_accounts
    where user_id = '51000000-0000-4000-8000-000000000001'
      and role = 'owner'
      and enabled
      and version = 1
  ),
  1::bigint,
  'the synthetic Auth principal has one enabled owner account'
);

select is(
  (
    select count(*)
    from auth.users as auth_user
    join auth.identities as identity on identity.user_id = auth_user.id
    join gioia_private.owner_accounts as owner on owner.user_id = auth_user.id
    where auth_user.id = '51000000-0000-4000-8000-000000000001'
      and identity.provider = 'email'
      and owner.enabled
  ),
  1::bigint,
  'the synthetic login identity and owner authorization reconcile one-to-one'
);

select * from finish();

rollback;
