import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Phase 4 root layout data isolation", () => {
  it("does not mount the appointment data provider for every route", () => {
    const rootLayout = readFileSync(
      join(process.cwd(), "app/layout.js"),
      "utf8",
    );

    expect(rootLayout).not.toContain("AppointmentProvider");
    expect(rootLayout).not.toContain("AppointmentContext");
  });
});
