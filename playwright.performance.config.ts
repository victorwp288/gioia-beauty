import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3102";
const target = new URL(baseURL);
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

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
  throw new Error("Performance profiling is restricted to a loopback build.");
}

export default defineConfig({
  testDir: "./tests/performance",
  outputDir: "test-results/performance",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    launchOptions: chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : undefined,
    trace: "on",
  },
  webServer: {
    command: `npm run start -- -H ${target.hostname} -p ${target.port}`,
    url: new URL("/", baseURL).href,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
