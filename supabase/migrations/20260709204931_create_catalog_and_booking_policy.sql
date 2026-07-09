begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table gioia_private.service_categories (
  id text primary key,
  display_name_it text not null,
  sort_order smallint not null unique,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint service_categories_id_format
    check (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint service_categories_display_name_bound
    check (length(btrim(display_name_it)) between 1 and 100),
  constraint service_categories_sort_order_nonnegative check (sort_order >= 0),
  constraint service_categories_version_positive check (version > 0)
);

create table gioia_private.services (
  id text primary key,
  category_id text not null
    references gioia_private.service_categories(id) on update restrict on delete restrict,
  display_name_it text not null,
  description_it text,
  sort_order smallint not null,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint services_id_format check (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint services_display_name_bound
    check (length(btrim(display_name_it)) between 1 and 160),
  constraint services_description_bound
    check (description_it is null or length(description_it) <= 2000),
  constraint services_sort_order_nonnegative check (sort_order >= 0),
  constraint services_version_positive check (version > 0),
  constraint services_category_sort_unique unique (category_id, sort_order)
);

create table gioia_private.service_variants (
  id text primary key,
  service_id text not null
    references gioia_private.services(id) on update restrict on delete restrict,
  display_name_it text not null,
  sort_order smallint not null,
  duration_minutes smallint not null,
  buffer_minutes smallint not null default 0,
  price_cents integer,
  currency character(3),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint service_variants_id_format
    check (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint service_variants_display_name_bound
    check (length(btrim(display_name_it)) between 1 and 160),
  constraint service_variants_sort_order_nonnegative check (sort_order >= 0),
  constraint service_variants_duration_bound check (duration_minutes between 1 and 480),
  constraint service_variants_buffer_bound check (buffer_minutes between 0 and 120),
  constraint service_variants_price_bound check (price_cents is null or price_cents >= 0),
  constraint service_variants_price_complete check (
    (price_cents is null and currency is null)
    or (
      price_cents is not null
      and currency is not null
      and currency = 'EUR'
    )
  ),
  constraint service_variants_version_positive check (version > 0),
  constraint service_variants_service_sort_unique unique (service_id, sort_order)
);

create table gioia_private.business_hours (
  weekday smallint not null,
  segment smallint not null default 1,
  opens_at_minutes smallint not null,
  closes_at_minutes smallint not null,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (weekday, segment),
  constraint business_hours_weekday_bound check (weekday between 1 and 7),
  constraint business_hours_segment_positive check (segment > 0),
  constraint business_hours_minutes_bound check (
    opens_at_minutes between 0 and 1439
    and closes_at_minutes between 1 and 1440
    and opens_at_minutes < closes_at_minutes
  ),
  constraint business_hours_version_positive check (version > 0),
  exclude using gist (
    weekday with =,
    (int4range(opens_at_minutes::integer, closes_at_minutes::integer, '[)')) with &&
  )
);

create table gioia_private.booking_policy (
  singleton boolean primary key default true,
  timezone text not null default 'Europe/Rome',
  slot_alignment_minutes smallint not null default 15,
  public_same_day_allowed boolean not null default false,
  public_min_lead_minutes integer not null default 0,
  public_max_advance_days smallint not null default 60,
  maximum_vacation_days smallint not null default 366,
  admin_conflict_override boolean not null default false,
  buffer_visible_to_customer boolean not null default false,
  vacation_conflict_behavior text not null default 'reject',
  completed_transition text not null default 'owner_explicit',
  admin_notification_email extensions.citext not null,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint booking_policy_singleton check (singleton),
  constraint booking_policy_timezone check (timezone = 'Europe/Rome'),
  constraint booking_policy_alignment_bound
    check (slot_alignment_minutes between 5 and 60 and 60 % slot_alignment_minutes = 0),
  constraint booking_policy_same_day_disabled check (not public_same_day_allowed),
  constraint booking_policy_lead_nonnegative check (public_min_lead_minutes >= 0),
  constraint booking_policy_advance_bound check (public_max_advance_days between 1 and 365),
  constraint booking_policy_vacation_bound check (maximum_vacation_days between 1 and 366),
  constraint booking_policy_no_conflict_override check (not admin_conflict_override),
  constraint booking_policy_hidden_buffer check (not buffer_visible_to_customer),
  constraint booking_policy_vacation_behavior check (vacation_conflict_behavior = 'reject'),
  constraint booking_policy_completed_transition check (completed_transition = 'owner_explicit'),
  constraint booking_policy_admin_email_bound
    check (length(btrim(admin_notification_email::text)) between 3 and 320),
  constraint booking_policy_version_positive check (version > 0)
);

insert into gioia_private.business_hours (
  weekday,
  segment,
  opens_at_minutes,
  closes_at_minutes
)
values
  (1, 1, 540, 1140),
  (2, 1, 600, 1200),
  (3, 1, 540, 1140),
  (4, 1, 600, 1200),
  (5, 1, 540, 1110);

insert into gioia_private.booking_policy (admin_notification_email)
values ('owner@example.test');

create index services_active_category_order_idx
  on gioia_private.services (category_id, sort_order, id)
  where active;
create index service_variants_active_service_order_idx
  on gioia_private.service_variants (service_id, sort_order, id)
  where active;

alter table gioia_private.service_categories enable row level security;
alter table gioia_private.service_categories force row level security;
alter table gioia_private.services enable row level security;
alter table gioia_private.services force row level security;
alter table gioia_private.service_variants enable row level security;
alter table gioia_private.service_variants force row level security;
alter table gioia_private.business_hours enable row level security;
alter table gioia_private.business_hours force row level security;
alter table gioia_private.booking_policy enable row level security;
alter table gioia_private.booking_policy force row level security;

create policy service_categories_mutator_select
  on gioia_private.service_categories for select to gioia_mutator using (true);
create policy service_categories_mutator_insert
  on gioia_private.service_categories for insert to gioia_mutator with check (true);
create policy service_categories_mutator_update
  on gioia_private.service_categories for update to gioia_mutator
  using (true) with check (true);
create policy services_mutator_select
  on gioia_private.services for select to gioia_mutator using (true);
create policy services_mutator_insert
  on gioia_private.services for insert to gioia_mutator with check (true);
create policy services_mutator_update
  on gioia_private.services for update to gioia_mutator using (true) with check (true);
create policy service_variants_mutator_select
  on gioia_private.service_variants for select to gioia_mutator using (true);
create policy service_variants_mutator_insert
  on gioia_private.service_variants for insert to gioia_mutator with check (true);
create policy service_variants_mutator_update
  on gioia_private.service_variants for update to gioia_mutator
  using (true) with check (true);
create policy business_hours_mutator_all
  on gioia_private.business_hours for all to gioia_mutator
  using (true) with check (true);
create policy booking_policy_mutator_select
  on gioia_private.booking_policy for select to gioia_mutator using (true);
create policy booking_policy_mutator_update
  on gioia_private.booking_policy for update to gioia_mutator
  using (true) with check (true);

grant select, insert, update on table
  gioia_private.service_categories,
  gioia_private.services,
  gioia_private.service_variants
to gioia_mutator;
grant select, insert, update on table gioia_private.business_hours
to gioia_mutator;
grant select, update on table gioia_private.booking_policy
to gioia_mutator;

create trigger service_categories_touch
before update on gioia_private.service_categories
for each row execute function gioia_private.set_updated_at_and_version();
create trigger services_touch
before update on gioia_private.services
for each row execute function gioia_private.set_updated_at_and_version();
create trigger service_variants_touch
before update on gioia_private.service_variants
for each row execute function gioia_private.set_updated_at_and_version();
create trigger business_hours_touch
before update on gioia_private.business_hours
for each row execute function gioia_private.set_updated_at_and_version();
create trigger booking_policy_touch
before update on gioia_private.booking_policy
for each row execute function gioia_private.set_updated_at_and_version();

revoke all on all tables in schema gioia_private from public, anon, authenticated, service_role, app_runtime;

commit;
