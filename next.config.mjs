import { assertEnvironment } from "./config/environment.mjs";

const { appEnv } = assertEnvironment(process.env, { command: "application" });

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_ENV: appEnv,
  },
  reactCompiler: {
    compilationMode: "annotation",
  },
};

export default nextConfig;
