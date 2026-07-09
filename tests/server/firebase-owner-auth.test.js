import { describe, expect, it } from "vitest";

import { assertFirebaseOwnerAuthEnvironment } from "@/lib/server/firebaseOwnerAuth";

describe("Firebase owner-auth sink isolation", () => {
  it("accepts only the exact demo project and Auth emulator", () => {
    expect(
      assertFirebaseOwnerAuthEnvironment({
        APP_ENV: "test",
        FIREBASE_ADMIN_PROJECT_ID: "demo-gioia-beauty",
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      }),
    ).toBe("demo-gioia-beauty");
  });

  it.each([
    {
      APP_ENV: "test",
      FIREBASE_ADMIN_PROJECT_ID: "other-project",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    },
    {
      APP_ENV: "test",
      FIREBASE_ADMIN_PROJECT_ID: "demo-gioia-beauty",
    },
    {
      APP_ENV: "production",
      FIREBASE_ADMIN_PROJECT_ID: "demo-gioia-beauty",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    },
  ])("rejects unsafe Firebase auth environment %#", (env) => {
    expect(() => assertFirebaseOwnerAuthEnvironment(env)).toThrow(
      /disabled|not isolated/,
    );
  });
});
