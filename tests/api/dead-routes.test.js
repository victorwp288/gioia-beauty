import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const removedRouteDirectories = [
  "app/api/appointments/by-date",
  "app/api/appointments/counts",
  "app/api/test",
];
const routeExtensions = ["js", "jsx", "ts", "tsx"];

describe("removed unauthenticated routes", () => {
  for (const directory of removedRouteDirectories) {
    for (const extension of routeExtensions) {
      const route = `${directory}/route.${extension}`;
      it(`${route} has no route module`, () => {
        expect(existsSync(resolve(process.cwd(), route))).toBe(false);
      });
    }
  }
});
