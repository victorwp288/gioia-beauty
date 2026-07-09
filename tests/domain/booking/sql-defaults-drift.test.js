import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOOKING_POLICY,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_OWNER_BOOKING_POLICY,
  ROME_TIME_ZONE,
} from "@/lib/domain/booking";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260709204931_create_catalog_and_booking_policy.sql",
    import.meta.url,
  ),
  "utf8",
);

function migrationBusinessHours() {
  const values = migration.match(
    /insert into gioia_private\.business_hours\s*\([\s\S]*?\)\s*values\s*([\s\S]*?);/,
  )?.[1];
  if (values === undefined) {
    throw new Error(
      "business-hours seed is missing from the committed migration",
    );
  }

  return [...values.matchAll(/\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g)].map(
    (match) => match.slice(1).map(Number),
  );
}

function domainBusinessHours() {
  return Object.entries(DEFAULT_BUSINESS_HOURS).flatMap(([weekday, segments]) =>
    segments.map((segment, index) => [
      Number(weekday),
      index + 1,
      segment.start,
      segment.end,
    ]),
  );
}

describe("booking configuration migration drift", () => {
  it("keeps committed business-hour rows equal to the explicit domain fixture", () => {
    expect(migrationBusinessHours()).toEqual(domainBusinessHours());
  });

  it("keeps committed public policy defaults equal to the explicit fixture", () => {
    const compactSql = migration.replace(/\s+/g, " ");
    expect(compactSql).toContain(
      `timezone text not null default '${ROME_TIME_ZONE}'`,
    );
    expect(compactSql).toContain(
      `slot_alignment_minutes smallint not null default ${DEFAULT_BOOKING_POLICY.slotAlignmentMinutes}`,
    );
    expect(compactSql).toContain(
      `public_same_day_allowed boolean not null default ${String(DEFAULT_BOOKING_POLICY.sameDayAllowed)}`,
    );
    expect(compactSql).toContain(
      `public_min_lead_minutes integer not null default ${DEFAULT_BOOKING_POLICY.minimumLeadMinutes}`,
    );
    expect(compactSql).toContain(
      `public_max_advance_days smallint not null default ${DEFAULT_BOOKING_POLICY.maximumAdvanceDays}`,
    );
  });

  it("uses the database alignment for the explicit owner policy fixture", () => {
    expect(DEFAULT_OWNER_BOOKING_POLICY.slotAlignmentMinutes).toBe(
      DEFAULT_BOOKING_POLICY.slotAlignmentMinutes,
    );
  });
});
