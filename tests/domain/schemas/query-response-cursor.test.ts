import { describe, expect, it } from "vitest";

import {
  AdminScheduleListResponseSchema,
  PublicAcceptedResponseSchema,
  PublicAvailabilityResponseSchema,
  ScheduleCountResponseSchema,
  ScheduleListQuerySchema,
  parseOutboxListSearchParams,
  parseScheduleCountSearchParams,
  parseScheduleExportSearchParams,
  parseScheduleListSearchParams,
  parseVacationListSearchParams,
} from "@/lib/domain/schemas/index.ts";

const CURSOR = `c1-key.e30.${"A".repeat(43)}`;

describe("HTTP query decoders", () => {
  it("parses repeated filters and canonical integers", () => {
    const parsed = parseScheduleListSearchParams(
      new URLSearchParams([
        ["fromDate", "2026-07-01"],
        ["toDate", "2026-07-31"],
        ["kind", "appointment"],
        ["status", "confirmed"],
        ["status", "completed"],
        ["pageSize", "25"],
        ["cursor", CURSOR],
      ]),
    );
    expect(parsed).toMatchObject({
      kind: "appointment",
      statuses: ["confirmed", "completed"],
      pageSize: 25,
      cursor: CURSOR,
    });
  });

  it("rejects duplicate singleton, unknown, and noncanonical values", () => {
    for (const query of [
      "fromDate=2026-07-01&fromDate=2026-07-02&toDate=2026-07-31",
      "fromDate=2026-07-01&toDate=2026-07-31&offset=0",
      "fromDate=2026-07-01&toDate=2026-07-31&pageSize=01",
      "fromDate=2026-07-01&toDate=2026-07-31&pageSize=50.0",
    ]) {
      expect(() =>
        parseScheduleListSearchParams(new URLSearchParams(query)),
      ).toThrow();
    }
  });

  it("rejects cursor whitespace instead of normalizing the wire token", () => {
    for (const cursor of [` ${CURSOR}`, `${CURSOR} `]) {
      expect(() =>
        parseScheduleListSearchParams(
          new URLSearchParams([
            ["fromDate", "2026-07-01"],
            ["toDate", "2026-07-31"],
            ["cursor", cursor],
          ]),
        ),
      ).toThrow();
    }
  });

  it("parses exact booleans without truthy coercion", () => {
    expect(
      parseScheduleExportSearchParams(
        new URLSearchParams(
          "fromDate=2026-01-01&toDate=2026-12-31&includeNotes=false",
        ),
      ).includeNotes,
    ).toBe(false);
    for (const value of ["False", "0", "yes"]) {
      expect(() =>
        parseScheduleExportSearchParams(
          new URLSearchParams(
            `fromDate=2026-01-01&toDate=2026-12-31&includeNotes=${value}`,
          ),
        ),
      ).toThrow();
    }
  });

  it("rejects kind/status contradictions and duplicate statuses", () => {
    expect(
      ScheduleListQuerySchema.safeParse({
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
        kind: "appointment",
        statuses: ["active"],
      }).success,
    ).toBe(false);
    expect(
      ScheduleListQuerySchema.safeParse({
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
        statuses: ["confirmed", "confirmed"],
      }).success,
    ).toBe(false);
  });

  it("provides bounded vacation, count, and outbox queries", () => {
    expect(
      parseVacationListSearchParams(
        new URLSearchParams("fromDate=2026-01-01&toDate=2026-12-31"),
      ).pageSize,
    ).toBe(50);
    expect(
      parseScheduleCountSearchParams(
        new URLSearchParams("fromDate=2026-07-01&toDate=2026-07-31"),
      ),
    ).toMatchObject({ fromDate: "2026-07-01", toDate: "2026-07-31" });
    expect(
      parseOutboxListSearchParams(
        new URLSearchParams("status=failed&status=dead_letter&pageSize=25"),
      ),
    ).toMatchObject({ statuses: ["failed", "dead_letter"], pageSize: 25 });
  });
});

describe("strict response DTOs", () => {
  it("allows availability slots only and rejects PII", () => {
    const response = {
      date: "2026-08-10",
      serviceId: "massaggio-relax",
      variantId: "massaggio-relax-60",
      slots: [600, 615, 630],
    };
    expect(PublicAvailabilityResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(
      PublicAvailabilityResponseSchema.safeParse({
        ...response,
        clientEmail: "maria@example.com",
      }).success,
    ).toBe(false);
    expect(
      PublicAvailabilityResponseSchema.safeParse({
        ...response,
        slots: [600, 600],
      }).success,
    ).toBe(false);
    expect(
      PublicAvailabilityResponseSchema.safeParse({
        ...response,
        slots: [600, 610],
      }).success,
    ).toBe(false);
    expect(
      PublicAvailabilityResponseSchema.safeParse({
        ...response,
        slots: Array.from({ length: 96 }, (_, index) => index * 15),
      }).success,
    ).toBe(true);
    expect(
      PublicAvailabilityResponseSchema.safeParse({
        ...response,
        slots: Array.from({ length: 97 }, (_, index) => index * 15),
      }).success,
    ).toBe(false);
  });

  it("keeps public accepted responses non-enumerating", () => {
    const response = { code: "REQUEST_ACCEPTED", replayed: false };
    expect(PublicAcceptedResponseSchema.safeParse(response).success).toBe(true);
    expect(
      PublicAcceptedResponseSchema.safeParse({
        ...response,
        email: "maria@example.com",
      }).success,
    ).toBe(false);
  });

  it("bounds admin pages and reconciles schedule counts", () => {
    expect(
      AdminScheduleListResponseSchema.parse({ items: [], nextCursor: null }),
    ).toEqual({ items: [], nextCursor: null });
    const counts = {
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      total: 3,
      byKind: { appointment: 2, block: 1 },
      byStatus: {
        confirmed: 2,
        completed: 0,
        cancelled: 0,
        noShow: 0,
        active: 1,
      },
    };
    expect(ScheduleCountResponseSchema.safeParse(counts).success).toBe(true);
    expect(
      ScheduleCountResponseSchema.safeParse({ ...counts, total: 4 }).success,
    ).toBe(false);
  });
});
