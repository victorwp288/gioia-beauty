begin;

set local search_path = extensions, public, pg_catalog;

select plan(11);

select is(
  (select count(*) from gioia_private.service_categories),
  12::bigint,
  'catalog has 12 source categories'
);

select is(
  (select count(*) from gioia_private.services),
  74::bigint,
  'catalog has 74 source services after exact deduplication'
);

select is(
  (select count(*) from gioia_private.service_variants),
  102::bigint,
  'catalog has 102 source variants'
);

select is(
  (
    select count(*)
    from gioia_private.service_variants as variant
    join gioia_private.services as service on service.id = variant.service_id
    join gioia_private.service_categories as category on category.id = service.category_id
    where not variant.active or not service.active or not category.active
      or variant.duration_minutes <= 0
      or variant.buffer_minutes < 0
  ),
  0::bigint,
  'every loaded variant has an active, bounded catalog path'
);

select results_eq(
  $actual$
    select weekday::integer, segment::integer,
      opens_at_minutes::integer, closes_at_minutes::integer
    from gioia_private.business_hours
    order by weekday, segment
  $actual$,
  $expected$
    values
      (1, 1, 540, 1140),
      (2, 1, 600, 1200),
      (3, 1, 540, 1140),
      (4, 1, 600, 1200),
      (5, 1, 540, 1110)
  $expected$,
  'business hours preserve the authoritative Monday-Friday schedule'
);

select results_eq(
  $actual$
    select timezone, slot_alignment_minutes::integer,
      public_same_day_allowed, public_min_lead_minutes,
      public_max_advance_days::integer, maximum_vacation_days::integer,
      admin_conflict_override, buffer_visible_to_customer,
      vacation_conflict_behavior, completed_transition,
      admin_notification_email::text
    from gioia_private.booking_policy
  $actual$,
  $expected$
    values (
      'Europe/Rome'::text, 15, false, 0, 60, 366, false, false,
      'reject'::text, 'owner_explicit'::text, 'owner@example.test'::text
    )
  $expected$,
  'booking policy is the reviewed Europe/Rome singleton'
);

select throws_ok(
  $$update gioia_private.booking_policy set slot_alignment_minutes = 10$$,
  '23514', null,
  'booking policy cannot drift from the cross-layer 15-minute contract'
);

select throws_ok(
  $$update gioia_private.booking_policy
    set admin_notification_email = 'Owner@Example.Test'$$,
  '23514', null,
  'owner notification email must remain normalized before outbox insertion'
);

select lives_ok(
  $sql$
    insert into gioia_private.business_hours (
      weekday, segment, opens_at_minutes, closes_at_minutes
    ) values (6, 1, 600, 660)
  $sql$,
  'a new non-overlapping opening-hours segment is accepted'
);

select lives_ok(
  $sql$
    insert into gioia_private.business_hours (
      weekday, segment, opens_at_minutes, closes_at_minutes
    ) values (6, 2, 660, 720)
  $sql$,
  'half-open adjacent opening-hours segments are accepted'
);

select throws_ok(
  $sql$
    insert into gioia_private.business_hours (
      weekday, segment, opens_at_minutes, closes_at_minutes
    ) values (6, 3, 650, 700)
  $sql$,
  '23P01',
  null,
  'overlapping opening-hours segments are rejected'
);

select * from finish();

rollback;
