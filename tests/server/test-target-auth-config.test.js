import { describe, expect, it, vi } from "vitest";

import { GREENFIELD_TEST_OWNER } from "../../scripts/test-target-fixture-sql.mjs";
import { verifyTestTargetAuthConfiguration } from "../../scripts/test-target-auth-config.mjs";

const KEY = `sb_publishable_${"p".repeat(32)}`;

function config(overrides = {}) {
  return {
    apiUrl: "https://hzibzwhrwmljgjjdzspi.supabase.co/",
    environment: "test",
    getPublishableKey: () => KEY,
    projectRef: "hzibzwhrwmljgjjdzspi",
    ...overrides,
  };
}

function json(status, value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("greenfield TEST Auth provider configuration", () => {
  it("proves settings and the disabled-signup endpoint with an existing fixture", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, { disable_signup: true, external: { email: true } }),
      )
      .mockResolvedValueOnce(json(422, { error_code: "signup_disabled" }));

    await expect(
      verifyTestTargetAuthConfiguration(config(), { fetchImpl }),
    ).resolves.toEqual({
      disableSignup: true,
      emailProvider: true,
      signupDenied: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [settingsUrl, settingsOptions] = fetchImpl.mock.calls[0];
    expect(settingsUrl.pathname).toBe("/auth/v1/settings");
    expect(settingsOptions.headers.get("apikey")).toBe(KEY);
    expect(settingsOptions.headers.has("authorization")).toBe(false);
    const [signupUrl, signupOptions] = fetchImpl.mock.calls[1];
    expect(signupUrl.pathname).toBe("/auth/v1/signup");
    expect(JSON.parse(signupOptions.body)).toMatchObject({
      email: GREENFIELD_TEST_OWNER.email,
    });
  });

  it.each([
    { disable_signup: false, external: { email: true } },
    { disable_signup: true, external: { email: false } },
    { external: { email: true } },
  ])("refuses unsafe settings without attempting signup %#", async (body) => {
    const fetchImpl = vi.fn(async () => json(200, body));
    await expect(
      verifyTestTargetAuthConfiguration(config(), { fetchImpl }),
    ).rejects.toThrow("Auth configuration is unsafe");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses a signup response that is not the exact disabled result", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, { disable_signup: true, external: { email: true } }),
      )
      .mockResolvedValueOnce(json(200, { user: { id: "unexpected" } }));
    await expect(
      verifyTestTargetAuthConfiguration(config(), { fetchImpl }),
    ).rejects.toThrow("Auth configuration is unsafe");
  });

  it("bounds responses and rejects any non-exact target", async () => {
    const fetchImpl = vi.fn(async () =>
      json(
        200,
        { disable_signup: true, external: { email: true } },
        { "content-length": String(16 * 1024 + 1) },
      ),
    );
    await expect(
      verifyTestTargetAuthConfiguration(config(), { fetchImpl }),
    ).rejects.toThrow("Auth configuration is unsafe");
    await expect(
      verifyTestTargetAuthConfiguration(
        config({ apiUrl: "https://www.gioiabeauty.net/" }),
        { fetchImpl },
      ),
    ).rejects.toThrow("Auth configuration is unsafe");
  });
});
