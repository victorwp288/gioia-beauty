import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PreviewE2eConfigError,
  parsePreviewE2eEnvironment,
} from "../../scripts/preview-e2e-config.mjs";

const HOST =
  "gioia-beauty-wgh2rxupe-victor-wejergang-petersens-projects.vercel.app";
const BRANCH_ALIAS =
  "gioia-beauty-git-refactor-victor-wejergang-petersens-projects.vercel.app";
const temporaryDirectories = [];

function storageState(mode = 0o600) {
  const directory = mkdtempSync(path.join(tmpdir(), "gioia-preview-config-"));
  temporaryDirectories.push(directory);
  chmodSync(directory, 0o700);
  const file = path.join(directory, "state.json");
  writeFileSync(
    file,
    JSON.stringify({
      cookies: [
        {
          name: "_vercel_jwt",
          value: "synthetic-protection-cookie-value",
          domain: HOST,
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    { mode },
  );
  chmodSync(file, mode);
  return file;
}

function environment(overrides = {}) {
  return {
    PLAYWRIGHT_PREVIEW_BASE_URL: `https://${HOST}`,
    PLAYWRIGHT_PREVIEW_COMMIT_SHA: "a".repeat(40),
    PLAYWRIGHT_PREVIEW_DEPLOYMENT_ID: `dpl_${"A".repeat(24)}`,
    PLAYWRIGHT_PREVIEW_STORAGE_STATE: storageState(),
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Preview E2E configuration", () => {
  it("accepts only the exact Preview deployment and private protection state", () => {
    expect(parsePreviewE2eEnvironment(environment())).toEqual({
      baseURL: `https://${HOST}/`,
      commitSha: "a".repeat(40),
      deploymentId: `dpl_${"A".repeat(24)}`,
      storageState: expect.stringContaining("gioia-preview-config-"),
    });
  });

  it.each([
    "https://www.gioiabeauty.net",
    "https://gioia-beauty.vercel.app",
    `https://${BRANCH_ALIAS}`,
    "https://gioia-beauty-abc-123-victor-wejergang-petersens-projects.vercel.app",
    `http://${HOST}`,
    `https://${HOST}/dashboard`,
    `https://${HOST}?target=preview`,
  ])("rejects a non-exact Preview URL: %s", (baseURL) => {
    expect(() =>
      parsePreviewE2eEnvironment(
        environment({ PLAYWRIGHT_PREVIEW_BASE_URL: baseURL }),
      ),
    ).toThrow(PreviewE2eConfigError);
  });

  it.each([
    { APP_ENV: "production" },
    { VERCEL_ENV: "production" },
    { GIOIA_PRODUCTION_APPROVAL_ID: "approval" },
    { GIOIA_PRODUCTION_OPERATOR_DATABASE_URL: "postgresql://production" },
  ])("rejects Production authority %#", (production) => {
    expect(() => parsePreviewE2eEnvironment(environment(production))).toThrow(
      "Preview E2E rejects every Production environment",
    );
  });

  it("rejects a group-readable protection state", () => {
    expect(() =>
      parsePreviewE2eEnvironment(
        environment({ PLAYWRIGHT_PREVIEW_STORAGE_STATE: storageState(0o640) }),
      ),
    ).toThrow("not an isolated temporary state");
  });

  it("rejects storage state containing application cookies", () => {
    const state = storageState();
    const parsed = JSON.parse(readFileSync(state, "utf8"));
    parsed.cookies.push({
      name: "gioia_owner_session",
      value: "must-not-persist",
      domain: HOST,
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    });
    writeFileSync(state, JSON.stringify(parsed), { mode: 0o600 });

    expect(() =>
      parsePreviewE2eEnvironment(
        environment({ PLAYWRIGHT_PREVIEW_STORAGE_STATE: state }),
      ),
    ).toThrow("not an isolated temporary state");
  });
});
