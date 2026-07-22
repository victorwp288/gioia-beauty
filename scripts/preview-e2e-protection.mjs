import { execFile as execFileCallback } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { promisify } from "node:util";
import path from "node:path";

import {
  parseExactPreviewUrl,
  parsePreviewDeploymentId,
} from "./preview-e2e-config.mjs";

const execFile = promisify(execFileCallback);
const COOKIE_NAME = "_vercel_jwt";

function isolatedTemporaryDirectory(directory) {
  const resolved = realpathSync(directory);
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new Error("Preview protection temporary directory is not private");
  }
  return resolved;
}

function parseCookieJar(source, previewUrl, nowSeconds) {
  const candidates = source
    .split(/\r?\n/u)
    .filter(
      (line) =>
        line.length > 0 &&
        (!line.startsWith("#") || line.startsWith("#HttpOnly_")),
    )
    .map((line) => line.split("\t"))
    .filter((fields) => fields.length === 7 && fields[5] === COOKIE_NAME);
  if (candidates.length !== 1) {
    throw new Error("Vercel protection cookie jar is not exact");
  }
  const fields = candidates[0];
  const httpOnly = fields[0].startsWith("#HttpOnly_");
  const domain = fields[0].replace(/^#HttpOnly_/u, "").replace(/^\./u, "");
  const includeSubdomains = fields[1] === "TRUE";
  const cookiePath = fields[2];
  const secure = fields[3] === "TRUE";
  const expiresRaw = Number(fields[4]);
  const value = fields[6];
  if (
    domain !== previewUrl.hostname ||
    includeSubdomains ||
    cookiePath !== "/" ||
    !secure ||
    !httpOnly ||
    !Number.isSafeInteger(expiresRaw) ||
    (expiresRaw !== 0 && expiresRaw <= nowSeconds) ||
    typeof value !== "string" ||
    value.length < 20
  ) {
    throw new Error("Vercel protection cookie is invalid");
  }
  return Object.freeze({
    name: COOKIE_NAME,
    value,
    domain,
    path: cookiePath,
    expires: expiresRaw === 0 ? -1 : expiresRaw,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
}

export async function createPreviewProtectionStorageState({
  baseURL,
  cwd = process.cwd(),
  deploymentId,
  execute = execFile,
  now = () => Date.now(),
  temporaryDirectory,
}) {
  const previewUrl = parseExactPreviewUrl(baseURL);
  parsePreviewDeploymentId(deploymentId);
  const directory = isolatedTemporaryDirectory(temporaryDirectory);
  const cookieJar = path.join(directory, "vercel-cookie.jar");
  const healthBody = path.join(directory, "health.json");
  const storageState = path.join(directory, "playwright-state.json");
  await execute(
    "bunx",
    [
      "vercel@56.5.0",
      "curl",
      "/api/health",
      "--deployment",
      previewUrl.href,
      "--yes",
      "--",
      "--silent",
      "--show-error",
      "--fail-with-body",
      "--location",
      "--header",
      "x-vercel-set-bypass-cookie: true",
      "--cookie-jar",
      cookieJar,
      "--output",
      healthBody,
    ],
    {
      cwd,
      env: process.env,
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    },
  );
  let healthSource;
  let cookieSource;
  try {
    healthSource = readFileSync(healthBody, "utf8");
    cookieSource = readFileSync(cookieJar, "utf8");
  } catch {
    throw new Error("Vercel Preview protection bootstrap did not reconcile");
  } finally {
    for (const temporaryFile of [healthBody, cookieJar]) {
      try {
        unlinkSync(temporaryFile);
      } catch {
        // A missing bootstrap file is handled by the read failure above.
      }
    }
  }
  let health;
  let cookie;
  try {
    health = JSON.parse(healthSource);
    cookie = parseCookieJar(
      cookieSource,
      previewUrl,
      Math.floor(now() / 1_000),
    );
  } catch {
    throw new Error("Vercel Preview protection bootstrap did not reconcile");
  }
  if (
    !health ||
    typeof health !== "object" ||
    Array.isArray(health) ||
    Object.keys(health).length !== 1 ||
    health.status !== "ok"
  ) {
    throw new Error("Vercel Preview health response is invalid");
  }
  writeFileSync(
    storageState,
    `${JSON.stringify({ cookies: [cookie], origins: [] })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  chmodSync(storageState, 0o600);
  return storageState;
}
