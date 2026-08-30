import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type ChromeTrace = {
  stop(): Promise<void>;
};

type ProfileWindow = Window & {
  __gioiaProfile?: {
    cls: number;
    lcp: number;
    longTasks: Array<{ duration: number; startTime: number }>;
    layoutShifts: Array<{
      hadRecentInput: boolean;
      startTime: number;
      value: number;
      sources: Array<{
        currentRect: DOMRectReadOnly;
        node: string | null;
        previousRect: DOMRectReadOnly;
      }>;
    }>;
  };
};

type AttachArtifact = (
  name: string,
  options: { body: Buffer; contentType: string },
) => Promise<void>;

async function startChromeTrace(
  context: BrowserContext,
  page: Page,
  attach: AttachArtifact,
): Promise<ChromeTrace> {
  const session = await context.newCDPSession(page);
  const traceEvents: unknown[] = [];
  session.on("Tracing.dataCollected", ({ value }) =>
    traceEvents.push(...value),
  );

  let completeTrace: (() => void) | undefined;
  const traceComplete = new Promise<void>((resolve) => {
    completeTrace = resolve;
  });
  session.once("Tracing.tracingComplete", () => completeTrace?.());
  await session.send("Tracing.start", {
    categories: [
      "blink.user_timing",
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "loading",
      "rail",
    ].join(","),
    options: "sampling-frequency=10000",
    transferMode: "ReportEvents",
  });

  return {
    async stop() {
      await session.send("Tracing.end");
      await traceComplete;
      await attach("chrome-performance-trace.json", {
        body: Buffer.from(JSON.stringify({ traceEvents })),
        contentType: "application/json",
      });
      await session.detach();
    },
  };
}

async function installBrowserMetrics(page: Page) {
  await page.addInitScript(() => {
    const profile: NonNullable<ProfileWindow["__gioiaProfile"]> = {
      cls: 0,
      lcp: 0,
      longTasks: [],
      layoutShifts: [],
    };
    (window as ProfileWindow).__gioiaProfile = profile;

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          profile.longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime,
          });
        }
      }).observe({ type: "longtask", buffered: true });
      new PerformanceObserver((list) => {
        profile.lcp = list.getEntries().at(-1)?.startTime ?? profile.lcp;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & {
            hadRecentInput?: boolean;
            sources?: Array<{
              currentRect: DOMRectReadOnly;
              node?: Node;
              previousRect: DOMRectReadOnly;
            }>;
            value?: number;
          }
        >) {
          const hadRecentInput = entry.hadRecentInput ?? false;
          const value = entry.value ?? 0;
          if (!hadRecentInput) profile.cls += value;
          profile.layoutShifts.push({
            hadRecentInput,
            startTime: entry.startTime,
            value,
            sources: (entry.sources ?? []).map((source) => ({
              currentRect: source.currentRect,
              node:
                source.node instanceof Element
                  ? `${source.node.tagName.toLowerCase()}${source.node.id ? `#${source.node.id}` : ""}.${[...source.node.classList].slice(0, 3).join(".")}`
                  : null,
              previousRect: source.previousRect,
            })),
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Navigation Timing and the CDP trace remain available in older browsers.
    }
  });
}

async function attachBrowserMetrics(page: Page, attach: AttachArtifact) {
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    return {
      navigation: navigation
        ? {
            domContentLoaded: navigation.domContentLoadedEventEnd,
            load: navigation.loadEventEnd,
            responseStart: navigation.responseStart,
            transferSize: navigation.transferSize,
          }
        : null,
      paint: Object.fromEntries(
        performance
          .getEntriesByType("paint")
          .map((entry) => [entry.name, entry.startTime]),
      ),
      profile: (window as ProfileWindow).__gioiaProfile,
      resources: performance.getEntriesByType("resource").length,
    };
  });
  await attach("browser-performance-metrics.json", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
  });
  return metrics;
}

test.beforeEach(async ({ page }) => {
  await installBrowserMetrics(page);
  await page.route("**/api/maintenance", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        code: "MAINTENANCE_STATUS",
        messageCode: "OPERATIONS_OPEN",
        ownerMutationsEnabled: true,
        publicBookingEnabled: true,
      }),
    });
  });
});

test("profiles the public home and deferred booking boundary without writes", async ({
  context,
  page,
}, testInfo) => {
  let writeRequests = 0;
  await page.route("**/api/bookings", async (route) => {
    writeRequests += 1;
    await route.abort("blockedbyclient");
  });
  await page.route("**/api/newsletter/subscribe", async (route) => {
    writeRequests += 1;
    await route.abort("blockedbyclient");
  });

  const chromeTrace = await startChromeTrace(
    context,
    page,
    testInfo.attach.bind(testInfo),
  );
  await page.goto("/", { waitUntil: "networkidle" });
  const cookieButton = page.getByRole("button", { name: "Ho capito" });
  if (await cookieButton.isVisible()) await cookieButton.click();

  await page
    .locator("#main-content")
    .getByRole("link", { name: "PRENOTA", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Prenota un appuntamento" }).last(),
  ).toBeVisible();
  await page.getByLabel("Trattamento*").selectOption({ index: 1 });
  await expect(page.locator('input[name="variant"]')).toHaveValue(/\d+/);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

  const metrics = await attachBrowserMetrics(
    page,
    testInfo.attach.bind(testInfo),
  );
  await chromeTrace.stop();
  expect(metrics.navigation?.responseStart).toBeGreaterThan(0);
  expect(writeRequests).toBe(0);
});

test("profiles gallery filtering and the lazy lightbox", async ({
  context,
  page,
}, testInfo) => {
  const chromeTrace = await startChromeTrace(
    context,
    page,
    testInfo.attach.bind(testInfo),
  );
  await page.goto("/gallery", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Trattamenti", exact: true }).click();
  await page.getByRole("button", { name: /Area Relax/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  const metrics = await attachBrowserMetrics(
    page,
    testInfo.attach.bind(testInfo),
  );
  await chromeTrace.stop();
  expect(metrics.navigation?.responseStart).toBeGreaterThan(0);
});
