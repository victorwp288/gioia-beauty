import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPreviewProtectionStorageState } from "../../scripts/preview-e2e-protection.mjs";

const HOST =
  "gioia-beauty-wgh2rxupe-victor-wejergang-petersens-projects.vercel.app";
const DEPLOYMENT_ID = `dpl_${"B".repeat(24)}`;
const temporaryDirectories = [];

function temporaryDirectory(mode = 0o700) {
  const directory = mkdtempSync(
    path.join(tmpdir(), "gioia-preview-protection-"),
  );
  temporaryDirectories.push(directory);
  chmodSync(directory, mode);
  return directory;
}

function cookieJar(value = "synthetic-protection-cookie-value") {
  return [
    "# Netscape HTTP Cookie File",
    `#HttpOnly_${HOST}\tFALSE\t/\tTRUE\t2000000000\t_vercel_jwt\t${value}`,
    "",
  ].join("\n");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Vercel Preview protection bootstrap", () => {
  it("writes one private Playwright cookie state and removes raw curl files", async () => {
    const directory = temporaryDirectory();
    const execute = vi.fn(async (_command, args) => {
      const jar = args[args.indexOf("--cookie-jar") + 1];
      const output = args[args.indexOf("--output") + 1];
      writeFileSync(jar, cookieJar());
      writeFileSync(output, JSON.stringify({ status: "ok" }));
    });

    const result = await createPreviewProtectionStorageState({
      baseURL: `https://${HOST}`,
      deploymentId: DEPLOYMENT_ID,
      execute,
      now: () => 1_900_000_000_000,
      temporaryDirectory: directory,
    });

    expect(execute).toHaveBeenCalledWith(
      "bunx",
      expect.arrayContaining([
        "vercel@56.5.0",
        "curl",
        "/api/health",
        "--deployment",
        `https://${HOST}/`,
        "--location",
        "x-vercel-set-bypass-cookie: true",
      ]),
      expect.objectContaining({ timeout: 30_000 }),
    );
    expect(existsSync(path.join(directory, "vercel-cookie.jar"))).toBe(false);
    expect(existsSync(path.join(directory, "health.json"))).toBe(false);
    expect(readFileSync(result, "utf8")).not.toContain("gioia_owner_session");
    expect(JSON.parse(readFileSync(result, "utf8"))).toEqual({
      cookies: [
        expect.objectContaining({
          name: "_vercel_jwt",
          domain: HOST,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        }),
      ],
      origins: [],
    });
  });

  it("rejects a non-private temporary directory before invoking Vercel", async () => {
    const execute = vi.fn();
    await expect(
      createPreviewProtectionStorageState({
        baseURL: `https://${HOST}`,
        deploymentId: DEPLOYMENT_ID,
        execute,
        temporaryDirectory: temporaryDirectory(0o755),
      }),
    ).rejects.toThrow("temporary directory is not private");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an invalid deployment ID before invoking Vercel", async () => {
    const execute = vi.fn();
    await expect(
      createPreviewProtectionStorageState({
        baseURL: `https://${HOST}`,
        deploymentId: "production",
        execute,
        temporaryDirectory: temporaryDirectory(),
      }),
    ).rejects.toThrow("PLAYWRIGHT_PREVIEW_DEPLOYMENT_ID is invalid");
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed on an unexpected health body or protection cookie", async () => {
    const directory = temporaryDirectory();
    const execute = vi.fn(async (_command, args) => {
      writeFileSync(args[args.indexOf("--cookie-jar") + 1], cookieJar("short"));
      writeFileSync(
        args[args.indexOf("--output") + 1],
        JSON.stringify({ status: "degraded" }),
      );
    });
    await expect(
      createPreviewProtectionStorageState({
        baseURL: `https://${HOST}`,
        deploymentId: DEPLOYMENT_ID,
        execute,
        temporaryDirectory: directory,
      }),
    ).rejects.toThrow(/Preview|protection|health/u);
    expect(existsSync(path.join(directory, "playwright-state.json"))).toBe(
      false,
    );
  });
});
