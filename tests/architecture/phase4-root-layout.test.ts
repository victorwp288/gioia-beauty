import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Phase 4 root layout data isolation", () => {
  it("keeps public layouts free of owner and appointment providers", () => {
    const italianLayout = readFileSync(
      join(process.cwd(), "app/(public-it)/layout.js"),
      "utf8",
    );
    const englishLayout = readFileSync(
      join(process.cwd(), "app/(public-en)/en/layout.js"),
      "utf8",
    );

    for (const publicLayout of [italianLayout, englishLayout]) {
      expect(publicLayout).not.toContain("AppointmentProvider");
      expect(publicLayout).not.toContain("AppointmentContext");
      expect(publicLayout).not.toContain("ThemeProvider");
      expect(publicLayout).not.toContain("NotificationProvider");
    }
  });

  it("keeps login bare and owner providers inside the dashboard layout", () => {
    const ownerLayout = readFileSync(
      join(process.cwd(), "app/(owner)/layout.js"),
      "utf8",
    );
    const dashboardLayout = readFileSync(
      join(process.cwd(), "app/(owner)/dashboard/layout.js"),
      "utf8",
    );

    expect(ownerLayout).toContain("index: false");
    expect(ownerLayout).not.toContain("ThemeProvider");
    expect(ownerLayout).not.toContain("NotificationProvider");
    expect(ownerLayout).not.toContain("react-toastify");
    expect(ownerLayout).not.toContain("DM_Serif_Display");
    expect(dashboardLayout).toContain("ThemeProvider");
    expect(dashboardLayout).toContain("NotificationProvider");
    expect(dashboardLayout).toContain("react-toastify");
  });

  it("loads optional dashboard panels only on interaction", () => {
    const dashboard = readFileSync(
      join(process.cwd(), "components/dashboard/Dashy.jsx"),
      "utf8",
    );

    expect(dashboard).toContain("dynamic(loadSubscriberList");
    expect(dashboard).toContain("dynamic(loadVacationManager");
    expect(dashboard).toContain("dynamic(loadPhoneNumberInput");
    expect(dashboard).toContain("onFocus={preloadSubscriberList}");
    expect(dashboard).toContain("onMouseEnter={preloadVacationManager}");
    expect(dashboard).toContain("onFocus={preloadPhoneNumberInput}");
    expect(dashboard).toContain("isSubscriberModalOpen ? (");
    expect(dashboard).toContain("isVacationModalOpen ? (");
    expect(dashboard).not.toContain('from "react-phone-input-2"');
  });
});
