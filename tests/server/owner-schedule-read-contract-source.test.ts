import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CONTRACT_NAMES = [
  "ownerScheduleReadContract",
  "ownerScheduleListResponseContract",
  "ownerScheduleCountReadContract",
  "ownerScheduleExportReadContract",
  "ownerScheduleExportResponseContract",
  "ownerOutboxReadContract",
  "ownerOutboxListResponseContract",
  "ownerSubscriberReadContract",
  "ownerSubscriberListResponseContract",
  "ownerVacationReadContract",
  "ownerVacationListResponseContract",
] as const;
const HANDLER_NAMES = [
  "ownerScheduleReadHandler",
  "ownerScheduleReadHandlerSupport",
  "ownerScheduleReadAuthorization",
  "ownerScheduleExportHandler",
  "ownerOutboxReadHandler",
  "ownerVacationSubscriberReadHandler",
] as const;

describe("owner schedule read contract source boundary", () => {
  it.each(CONTRACT_NAMES)(
    "keeps %s server-only and operationally inert",
    (name) => {
      const source = readFileSync(
        resolve(ROOT, `lib/server/database/${name}.ts`),
        "utf8",
      );
      expect(source.startsWith('import "server-only";')).toBe(true);
      expect(source.split("\n").length).toBeLessThanOrEqual(300);
      for (const forbidden of [
        "process.env",
        "fetch(",
        "console.",
        "createRuntimeDatabase",
        "ownerTransaction",
        "freshOwnerSession",
        "next/headers",
        "setTimeout",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    },
  );

  it.each(HANDLER_NAMES)("keeps %s server-only and inert", (name) => {
    const source = readFileSync(resolve(ROOT, `lib/server/${name}.ts`), "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source.split("\n").length).toBeLessThanOrEqual(300);
    for (const forbidden of [
      "process.env",
      "fetch(",
      "console.",
      "createRuntimeDatabase",
      "ownerTransaction",
      "ownerAuthRepository",
      "next/headers",
      "setTimeout",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it.each([
    [
      "app/api/admin/schedule/route.ts",
      "ownerScheduleReadRepository",
      "createOwnerScheduleListGetHandler",
    ],
    [
      "app/api/admin/schedule/count/route.ts",
      "ownerScheduleReadRepository",
      "createOwnerScheduleCountGetHandler",
    ],
    [
      "app/api/admin/schedule/export/route.ts",
      "ownerScheduleReadRepository",
      "createOwnerScheduleExportGetHandler",
    ],
    [
      "app/api/admin/vacations/route.ts",
      "ownerOperationsReadRepository",
      "createOwnerVacationListGetHandler",
    ],
    [
      "app/api/admin/subscribers/route.ts",
      "ownerOperationsReadRepository",
      "createOwnerSubscriberListGetHandler",
    ],
    [
      "app/api/admin/outbox/route.ts",
      "ownerOperationsReadRepository",
      "createOwnerOutboxListGetHandler",
    ],
  ])(
    "activates %s through its bounded server repository",
    (path, repository, factory) => {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      expect(source.startsWith('import "server-only";')).toBe(true);
      expect(source).toContain(repository);
      expect(source).toContain(factory);
      expect(source).toContain("createNextOwnerReadContext");
      expect(source).toContain("observeServerRoute");
    },
  );
});
