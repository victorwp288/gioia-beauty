import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import nextEnv from "@next/env";

import { assertEnvironment } from "./config/environment.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);
assertEnvironment(process.env, { command: "test" });

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    clearMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          exclude: ["tests/ui/**"],
          include: ["tests/**/*.test.{js,jsx,ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["tests/ui/**/*.test.{js,jsx,ts,tsx}"],
          setupFiles: ["./tests/setup/dom.ts"],
        },
      },
    ],
    restoreMocks: true,
  },
});
