import { expect, test } from "@playwright/test";

import {
  installPublicBrowserBoundaryAudit,
  PHASE4_PUBLIC_CLOCK,
} from "./phase4-public-browser-support.ts";

test.describe("Phase 4 public static browser boundary", () => {
  test("non-booking pages make zero business-data requests", async ({
    page,
  }) => {
    await page.clock.setFixedTime(PHASE4_PUBLIC_CLOCK);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const audit = installPublicBrowserBoundaryAudit(page);

    for (const expected of [
      { path: "/gallery", heading: "Galleria" },
      { path: "/contacts", heading: "I nostri contatti" },
      {
        path: "/policy",
        heading: "INFORMATIVA SULLA PRIVACY - Art.13 Regolamento (UE) 2016/679",
      },
    ]) {
      await page.goto(expected.path, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: expected.heading, exact: true }),
      ).toBeVisible();
    }

    expect(
      audit.businessRequests().map(({ method, url }) => `${method} ${url}`),
    ).toEqual([]);
    await audit.assertSafe();
  });

  test("primary public navigation remains keyboard operable", async ({
    page,
  }) => {
    await page.clock.setFixedTime(PHASE4_PUBLIC_CLOCK);
    const audit = installPublicBrowserBoundaryAudit(page);
    await page.setViewportSize({ width: 1_280, height: 800 });
    await page.goto("/gallery", { waitUntil: "domcontentloaded" });

    const contacts = page.getByRole("link", { name: "CONTATTI", exact: true });
    await contacts.focus();
    await expect(contacts).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/contacts$/u);
    await expect(
      page.getByRole("heading", { name: "I nostri contatti", exact: true }),
    ).toBeVisible();

    expect(audit.businessRequests()).toEqual([]);
    await audit.assertSafe();
  });
});
