import { expect, test } from "@playwright/test";

import {
  assertBookingBody,
  chooseSlotWithKeyboard,
  fillSyntheticBooking,
  installAvailabilityRoute,
  installPublicBrowserBoundaryAudit,
  json,
  openStablePublicHome,
  PHASE4_PUBLIC_PERSON,
  PHASE4_PUBLIC_REQUEST_ID,
  PHASE4_PUBLIC_RESOURCE_ID,
  removeLocalFrameworkDevOverlay,
  selectFirstAvailableDateWithKeyboard,
} from "./phase4-public-browser-support.ts";

test.describe("Phase 4 public booking browser acceptance", () => {
  test.describe.configure({ timeout: 60_000 });

  test("golden path is keyboard-operable and matches desktop/mobile baselines", async ({
    page,
  }) => {
    const audit = installPublicBrowserBoundaryAudit(page);
    await installAvailabilityRoute(page, () => [540, 555, 570]);
    let bookingRequest = null;
    await page.route("**/api/bookings", async (route) => {
      bookingRequest = route.request();
      await assertBookingBody(bookingRequest);
      await json(route, 201, {
        code: "BOOKING_CREATED",
        replayed: false,
        resourceId: PHASE4_PUBLIC_RESOURCE_ID,
      });
    });

    await openStablePublicHome(page);
    await selectFirstAvailableDateWithKeyboard(page);
    await chooseSlotWithKeyboard(page);
    await fillSyntheticBooking(page);

    const bookingSection = page.locator("#booking-section");
    await removeLocalFrameworkDevOverlay(page);
    await expect(bookingSection).toHaveScreenshot(
      "phase4-public-booking-desktop.png",
      {
        animations: "disabled",
      },
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await bookingSection.evaluate((section) =>
      section.scrollIntoView({ block: "start" }),
    );
    await removeLocalFrameworkDevOverlay(page);
    await expect(page).toHaveScreenshot("phase4-public-booking-mobile.png", {
      animations: "disabled",
    });
    const horizontalOverflow = await page
      .locator("body")
      .evaluate((body) => Math.max(0, body.scrollWidth - body.clientWidth));
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1_440, height: 1_000 });

    const submit = page.getByRole("button", {
      name: "Prenota Appuntamento",
      exact: true,
    });
    await submit.focus();
    await expect(submit).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Appointment Booked" }),
    ).toBeVisible();
    expect(bookingRequest).not.toBeNull();
    await expect(page.getByLabel("Nome e Cognome*")).toHaveValue("");
    await expect(page.getByLabel("Email*")).toHaveValue("");
    await expect(
      page.getByRole("dialog", { name: "Appointment Booked" }),
    ).not.toContainText(PHASE4_PUBLIC_PERSON.email);
    await audit.assertSafe({ bookingPosts: 1 });
  });

  test("availability recovery and ambiguous booking retry retain one idempotency key", async ({
    page,
  }) => {
    const audit = installPublicBrowserBoundaryAudit(page);
    const availability = await installAvailabilityRoute(page, (call) =>
      call === 1 ? "unavailable" : [540, 555],
    );
    const idempotencyKeys: string[] = [];
    let bookingCalls = 0;
    await page.route("**/api/bookings", async (route) => {
      bookingCalls += 1;
      const request = route.request();
      await assertBookingBody(request);
      idempotencyKeys.push((await request.headerValue("idempotency-key"))!);
      if (bookingCalls === 1) {
        await route.abort("failed");
        return;
      }
      await json(route, 201, {
        code: "BOOKING_CREATED",
        replayed: true,
        resourceId: PHASE4_PUBLIC_RESOURCE_ID,
      });
    });

    await openStablePublicHome(page);
    await selectFirstAvailableDateWithKeyboard(page);
    await expect(page.getByRole("button", { name: "Riprova" })).toBeVisible();
    await page.getByRole("button", { name: "Riprova" }).click();
    await expect.poll(availability.calls).toBe(2);
    await chooseSlotWithKeyboard(page);
    await fillSyntheticBooking(page);

    const submit = page.getByRole("button", { name: "Prenota Appuntamento" });
    await submit.click();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(
      page.getByRole("dialog", { name: "Appointment Booked" }),
    ).toBeVisible();
    expect(idempotencyKeys).toHaveLength(2);
    expect(new Set(idempotencyKeys)).toEqual(new Set([idempotencyKeys[0]]));
    await audit.assertSafe({ bookingPosts: 2 });
  });

  test("stale slot failure clears selection and refetches canonical availability", async ({
    page,
  }) => {
    const audit = installPublicBrowserBoundaryAudit(page);
    const availability = await installAvailabilityRoute(page, (call) =>
      call === 1 ? [540, 555] : [555],
    );
    await page.route("**/api/bookings", async (route) => {
      await assertBookingBody(route.request());
      await json(route, 409, {
        code: "SLOT_UNAVAILABLE",
        requestId: PHASE4_PUBLIC_REQUEST_ID,
      });
    });

    await openStablePublicHome(page);
    await selectFirstAvailableDateWithKeyboard(page);
    await chooseSlotWithKeyboard(page);
    await fillSyntheticBooking(page);
    await page.getByRole("button", { name: "Prenota Appuntamento" }).click();

    await expect.poll(availability.calls).toBe(2);
    await expect(
      page.getByText(
        "L’orario scelto non è più disponibile. Selezionane un altro.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "09:00", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "09:15", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Prenota Appuntamento" }),
    ).toBeDisabled();
    await audit.assertSafe({ bookingPosts: 1 });
  });
});
