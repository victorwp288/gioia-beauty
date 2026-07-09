import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const removedRoutes = [
  "app/api/appointments/by-date/route.js",
  "app/api/appointments/counts/route.js",
  "app/api/test/route.js",
];

describe("removed unauthenticated routes", () => {
  for (const route of removedRoutes) {
    it(`${route} has no route module`, () => {
      expect(existsSync(resolve(process.cwd(), route))).toBe(false);
    });
  }
});
