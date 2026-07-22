import { defineConfig } from "@playwright/test";

import { parsePreviewE2eEnvironment } from "./scripts/preview-e2e-config.mjs";

const preview = parsePreviewE2eEnvironment(process.env);
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/preview",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/preview" }],
  ],
  use: {
    baseURL: preview.baseURL,
    storageState: preview.storageState,
    launchOptions: chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : undefined,
    trace: "off",
  },
  projects: [
    {
      name: "phase4-public",
      testMatch: /phase4-public-.*\.spec\.ts/,
    },
    {
      name: "phase4-preview-hosted",
      testMatch: /phase4-preview-.*\.spec\.ts/,
    },
  ],
});
