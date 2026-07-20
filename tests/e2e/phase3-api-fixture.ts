import { test as base, expect } from "@playwright/test";
import postgres from "postgres";

import { getBookingConcurrencyTargets } from "../../scripts/booking-concurrency-suite.mjs";
import { getLocalRouteStatus } from "../../scripts/local-owner-auth-harness.mjs";

export interface BookingTarget {
  readonly localDate: string;
  readonly serviceId: string;
  readonly variantId: string;
}

export type LocalDatabase = ReturnType<typeof postgres>;

interface Phase3ApiFixtures {
  readonly bookingTarget: BookingTarget;
  readonly localDatabase: LocalDatabase;
}

function exactBookingTarget(value: unknown): BookingTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local booking target is invalid");
  }
  const target = value as Record<string, unknown>;
  if (
    typeof target.localDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(target.localDate) ||
    typeof target.serviceId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(target.serviceId) ||
    typeof target.variantId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(target.variantId)
  ) {
    throw new Error("Local booking target identifiers are invalid");
  }
  return Object.freeze({
    localDate: target.localDate,
    serviceId: target.serviceId,
    variantId: target.variantId,
  });
}

export const test = base.extend<Phase3ApiFixtures>({
  localDatabase: async ({}, provide) => {
    const status = await getLocalRouteStatus();
    const sql = postgres(status.databaseUrl, {
      prepare: false,
      max: 1,
      idle_timeout: 1,
      connect_timeout: 5,
      onnotice: () => {},
    });
    try {
      await provide(sql);
    } finally {
      await sql.end({ timeout: 2 });
    }
  },
  bookingTarget: async ({ localDatabase }, provide) => {
    const targets = (await getBookingConcurrencyTargets(
      localDatabase,
    )) as unknown;
    if (!Array.isArray(targets) || targets.length !== 5) {
      throw new Error("Local booking targets are unavailable");
    }
    await provide(exactBookingTarget(targets[0]));
  },
});

export { expect };
