import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const target = new URL(baseURL);

if (
  target.protocol !== "http:" ||
  !new Set(["127.0.0.1", "localhost"]).has(target.hostname) ||
  !target.port ||
  target.username ||
  target.password ||
  !["", "/"].includes(target.pathname) ||
  target.search ||
  target.hash
) {
  throw new Error(
    "Playwright is loopback-only until the serialized TEST target is explicitly added.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  globalSetup: "./tests/e2e/phase3-global-setup.ts",
  globalTeardown: "./tests/e2e/phase3-global-teardown.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phase3-api",
      testMatch: /phase3-.*\.spec\.ts/,
    },
  ],
  webServer: {
    command: "node scripts/start-local-phase3-e2e-server.mjs",
    url: new URL("/api/health", baseURL).href,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
