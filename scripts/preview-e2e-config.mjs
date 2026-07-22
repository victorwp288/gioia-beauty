import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const GIOIA_VERCEL_PROJECT_ID = "prj_MfVovj7JrjQqufswo8wofHh1EErN";
export const GIOIA_VERCEL_ORG_ID = "team_BeucOPCD3hO3H5CZnZGfwkJc";
export const GIOIA_PREVIEW_BRANCH_HOST =
  "gioia-beauty-git-refactor-victor-wejergang-petersens-projects.vercel.app";

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const IMMUTABLE_PREVIEW_HOST =
  /^gioia-beauty-[a-z0-9]{6,64}-victor-wejergang-petersens-projects\.vercel\.app$/u;
const FORBIDDEN_ENVIRONMENT_KEYS = new Set([
  "GIOIA_PRODUCTION_APPROVAL_ID",
  "GIOIA_PRODUCTION_OPERATOR_DATABASE_URL",
  "PRODUCTION_SUPABASE_REF",
]);

export class PreviewE2eConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreviewE2eConfigError";
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new PreviewE2eConfigError(`${name} is required`);
  }
  return value;
}

export function parseExactPreviewUrl(value) {
  let url;
  try {
    url = new URL(requiredString(value, "PLAYWRIGHT_PREVIEW_BASE_URL"));
  } catch (error) {
    if (error instanceof PreviewE2eConfigError) throw error;
    throw new PreviewE2eConfigError("PLAYWRIGHT_PREVIEW_BASE_URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    !IMMUTABLE_PREVIEW_HOST.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    !["", "/"].includes(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new PreviewE2eConfigError(
      "PLAYWRIGHT_PREVIEW_BASE_URL must be an immutable Gioia Preview deployment URL",
    );
  }
  return new URL(url.origin);
}

export function parsePreviewDeploymentId(value) {
  const deploymentId = requiredString(
    value,
    "PLAYWRIGHT_PREVIEW_DEPLOYMENT_ID",
  );
  if (!DEPLOYMENT_ID.test(deploymentId)) {
    throw new PreviewE2eConfigError(
      "PLAYWRIGHT_PREVIEW_DEPLOYMENT_ID is invalid",
    );
  }
  return deploymentId;
}

function assertNoProductionEnvironment(env) {
  const forbidden = Object.keys(env).filter(
    (key) =>
      (FORBIDDEN_ENVIRONMENT_KEYS.has(key) ||
        /^GIOIA_PRODUCTION_/u.test(key)) &&
      typeof env[key] === "string" &&
      env[key] !== "",
  );
  if (
    forbidden.length > 0 ||
    env.APP_ENV === "production" ||
    env.NEXT_PUBLIC_APP_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.VERCEL_TARGET_ENV === "production"
  ) {
    throw new PreviewE2eConfigError(
      "Preview E2E rejects every Production environment",
    );
  }
}

function exactStorageState(filePath, previewUrl) {
  const suppliedPath = path.resolve(
    requiredString(filePath, "PLAYWRIGHT_PREVIEW_STORAGE_STATE"),
  );
  let resolvedPath;
  let stat;
  let suppliedStat;
  let state;
  try {
    suppliedStat = lstatSync(suppliedPath);
    resolvedPath = realpathSync(suppliedPath);
    stat = lstatSync(resolvedPath);
    state = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch {
    throw new PreviewE2eConfigError(
      "PLAYWRIGHT_PREVIEW_STORAGE_STATE is unreadable",
    );
  }
  const temporaryRoot = `${realpathSync(tmpdir())}${path.sep}`;
  if (
    suppliedStat.isSymbolicLink() ||
    !resolvedPath.startsWith(temporaryRoot) ||
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    !Array.isArray(state.cookies) ||
    state.cookies.length !== 1 ||
    !Array.isArray(state.origins) ||
    state.origins.length !== 0
  ) {
    throw new PreviewE2eConfigError(
      "PLAYWRIGHT_PREVIEW_STORAGE_STATE is not an isolated temporary state",
    );
  }
  const cookie = state.cookies[0];
  if (
    !cookie ||
    cookie.name !== "_vercel_jwt" ||
    typeof cookie.value !== "string" ||
    cookie.value.length < 20 ||
    cookie.domain !== previewUrl.hostname ||
    cookie.path !== "/" ||
    !Number.isSafeInteger(cookie.expires) ||
    (cookie.expires !== -1 &&
      cookie.expires <= Math.floor(Date.now() / 1_000)) ||
    cookie.httpOnly !== true ||
    cookie.secure !== true ||
    cookie.sameSite !== "Lax"
  ) {
    throw new PreviewE2eConfigError(
      "PLAYWRIGHT_PREVIEW_STORAGE_STATE has an invalid protection cookie",
    );
  }
  return resolvedPath;
}

export function parsePreviewE2eEnvironment(env = process.env) {
  assertNoProductionEnvironment(env);
  const baseUrl = parseExactPreviewUrl(env.PLAYWRIGHT_PREVIEW_BASE_URL);
  const deploymentId = parsePreviewDeploymentId(
    env.PLAYWRIGHT_PREVIEW_DEPLOYMENT_ID,
  );
  const commitSha = requiredString(
    env.PLAYWRIGHT_PREVIEW_COMMIT_SHA,
    "PLAYWRIGHT_PREVIEW_COMMIT_SHA",
  );
  if (!COMMIT_SHA.test(commitSha)) {
    throw new PreviewE2eConfigError("PLAYWRIGHT_PREVIEW_COMMIT_SHA is invalid");
  }
  return Object.freeze({
    baseURL: baseUrl.href,
    commitSha,
    deploymentId,
    storageState: exactStorageState(
      env.PLAYWRIGHT_PREVIEW_STORAGE_STATE,
      baseUrl,
    ),
  });
}
