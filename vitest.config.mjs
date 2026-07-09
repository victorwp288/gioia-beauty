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
    environment: "node",
    include: ["tests/**/*.test.{js,jsx}"],
    restoreMocks: true,
  },
});
