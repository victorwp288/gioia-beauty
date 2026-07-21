import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_PREVIEW_ROLE_SQL,
  GREENFIELD_RUNTIME_ROLE_SQL,
  withGreenfieldTestLock,
} from "../../scripts/test-target-harness.mjs";
import { verifyPreviewCredential } from "../../scripts/test-target-runtime-role.mjs";
import {
  config,
  lifecycleHarness,
  operatorSessionUrl,
  operatorWorkerUrl,
  PREVIEW_PASSWORD,
  runtimeUrl,
} from "./test-target-preview-runtime-helpers.js";

describe("greenfield TEST durable Preview runtime", () => {
  it("targets only the carrier for credentials and the authorization role for privileges", () => {
    expect(GREENFIELD_PREVIEW_ROLE_SQL.authenticate).toContain(
      "session_user = 'app_runtime_login'",
    );
    expect(GREENFIELD_PREVIEW_ROLE_SQL.authenticate).toContain(
      "current_user = 'app_runtime_login'",
    );
    expect(GREENFIELD_PREVIEW_ROLE_SQL.assume).toBe(
      "set local role app_runtime",
    );
    expect(GREENFIELD_PREVIEW_ROLE_SQL.authorize).toContain(
      "current_user = 'app_runtime'",
    );
    expect(GREENFIELD_PREVIEW_ROLE_SQL.authorize).toContain(
      "gioia_private.get_cutover_write_state()",
    );
    expect(GREENFIELD_PREVIEW_ROLE_SQL.restore[1]).toContain(
      "alter role app_runtime_login login",
    );
    expect(GREENFIELD_RUNTIME_ROLE_SQL.cleanup[0]).toBe(
      "alter role app_runtime_login nologin password null valid until 'infinity'",
    );
    expect(GREENFIELD_RUNTIME_ROLE_SQL.setup[1]).toBe(
      "grant app_runtime to postgres with inherit false, set true granted by current_user",
    );
    expect(GREENFIELD_RUNTIME_ROLE_SQL.state).toContain(
      "login_role.rolname = 'app_runtime_login'",
    );
    expect(GREENFIELD_RUNTIME_ROLE_SQL.state).toContain(
      "authorization_role.rolname = 'app_runtime'",
    );
    expect(GREENFIELD_RUNTIME_ROLE_SQL.state).toContain("as has_unsafe_access");
  });

  it("fails closed when the versioned carrier role is missing", async () => {
    const state = lifecycleHarness({ rolePresent: false });
    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        ...state.options,
      }),
    ).rejects.toThrow("runtime role state is invalid");

    expect(callback).not.toHaveBeenCalled();
    expect(state.events).toEqual(["lock", "unlock"]);
  });

  it("contains a carrier with unexpected role membership", async () => {
    const state = lifecycleHarness({ hasUnsafeMembership: true });
    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        ...state.options,
      }),
    ).rejects.toThrow("unsafe Preview role containment failed");

    expect(callback).not.toHaveBeenCalled();
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events.at(-1)).toBe("unlock");
  });

  it("contains a carrier with direct access or ownership residue", async () => {
    const state = lifecycleHarness({ hasUnsafeAccess: true });
    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        ...state.options,
      }),
    ).rejects.toThrow("unsafe Preview role containment failed");

    expect(callback).not.toHaveBeenCalled();
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events.at(-1)).toBe("unlock");
  });

  it("suspends and restores the exact credential before unlocking", async () => {
    const state = lifecycleHarness();

    await withGreenfieldTestLock(
      config(),
      async ({ recoverRuntimeRole }) => {
        expect(recoverRuntimeRole).toBeTypeOf("function");
        expect(state.roleCanLogin()).toBe(false);
      },
      state.options,
    );

    expect(state.roleCanLogin()).toBe(true);
    expect(state.events).toEqual([
      "lock",
      "wait-125000",
      "authenticate-0",
      "close-auth",
      "suspend",
      "suspend",
      "restore",
      "wait-125000",
      "authenticate-1",
      "close-auth",
      "unlock",
    ]);
    expect(
      state.credentialClients.every(({ end }) => end.mock.calls.length === 1),
    ).toBe(true);
    expect(state.credentialPropagationWait).toHaveBeenCalledTimes(2);
    expect(state.credentialPropagationWait).toHaveBeenNthCalledWith(1, 125_000);
    expect(state.credentialPropagationWait).toHaveBeenNthCalledWith(2, 125_000);
    for (const client of state.credentialClients) {
      expect(client.transactionUnsafe).toHaveBeenNthCalledWith(
        1,
        GREENFIELD_PREVIEW_ROLE_SQL.authenticate,
      );
      expect(client.transactionUnsafe).toHaveBeenNthCalledWith(
        2,
        GREENFIELD_PREVIEW_ROLE_SQL.assume,
      );
      expect(client.transactionUnsafe).toHaveBeenNthCalledWith(
        3,
        GREENFIELD_PREVIEW_ROLE_SQL.authorize,
      );
    }
    const restoreTransaction = state.lockClient.begin.mock.calls[0][0];
    const restoreUnsafe = vi.fn(async () => []);
    await restoreTransaction({ unsafe: restoreUnsafe });
    const passwordCall = restoreUnsafe.mock.calls.find(
      ([query]) => query === GREENFIELD_PREVIEW_ROLE_SQL.restore[0],
    );
    expect(passwordCall?.[1]).toEqual([PREVIEW_PASSWORD]);
    expect(GREENFIELD_PREVIEW_ROLE_SQL.restore[1]).not.toContain(
      PREVIEW_PASSWORD,
    );
    expect(state.clientFactory.mock.calls.map(([url]) => url)).toEqual([
      operatorSessionUrl,
      operatorWorkerUrl,
    ]);
    expect(
      state.credentialVerifier.mock.calls.map(
        ([request]) => request.databaseUrl,
      ),
    ).toEqual([runtimeUrl, runtimeUrl]);
    const [, sessionOptions] = state.clientFactory.mock.calls[0];
    expect(sessionOptions.connection).toEqual({
      application_name: "gioia_greenfield_test",
      lock_timeout: "5s",
      statement_timeout: "30s",
    });
    for (const [, transactionOptions] of state.clientFactory.mock.calls.slice(
      1,
    )) {
      expect(transactionOptions.connection).toEqual({
        application_name: "gioia_greenfield_test",
      });
    }
  });

  it("contains an active credential that cannot authenticate", async () => {
    const state = lifecycleHarness({ authorizations: [false] });
    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        ...state.options,
      }),
    ).rejects.toThrow("durable Preview credential could not authenticate");
    expect(callback).not.toHaveBeenCalled();
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events).toEqual([
      "lock",
      "wait-125000",
      "authenticate-0",
      "close-auth",
      "suspend",
      "unlock",
    ]);
    expect(state.credentialPropagationWait).toHaveBeenCalledOnce();
    expect(state.credentialPropagationWait).toHaveBeenCalledWith(125_000);
  });

  it("holds an active durable credential behind the quiet period", async () => {
    const operationFailure = new Error("synthetic checkpoint failure");
    const state = lifecycleHarness({ authorizations: [true] });
    let releaseWait;
    const credentialPropagationWait = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseWait = resolve;
        }),
    );

    const operation = withGreenfieldTestLock(
      config(),
      async () => {
        throw operationFailure;
      },
      { ...state.options, credentialPropagationWait },
    );

    await vi.waitFor(() => {
      expect(credentialPropagationWait).toHaveBeenCalledWith(125_000);
    });
    expect(state.credentialVerifier).not.toHaveBeenCalled();

    releaseWait();
    await expect(operation).rejects.toBe(operationFailure);
    expect(state.credentialVerifier).toHaveBeenCalledOnce();
  });

  it("recovers an interrupted suspended credential before the checkpoint", async () => {
    const state = lifecycleHarness({ initialLogin: false });

    await withGreenfieldTestLock(
      config(),
      async () => {
        state.events.push("callback");
        expect(state.roleCanLogin()).toBe(false);
      },
      state.options,
    );

    expect(state.events).toEqual([
      "lock",
      "restore",
      "wait-125000",
      "authenticate-0",
      "close-auth",
      "suspend",
      "callback",
      "suspend",
      "restore",
      "wait-125000",
      "authenticate-1",
      "close-auth",
      "unlock",
    ]);
    expect(state.roleCanLogin()).toBe(true);
    expect(state.credentialPropagationWait).toHaveBeenCalledTimes(2);
    expect(state.credentialPropagationWait).toHaveBeenNthCalledWith(1, 125_000);
    expect(state.credentialPropagationWait).toHaveBeenNthCalledWith(2, 125_000);
  });

  it.each(["08006", "ECONNREFUSED", "28P01"])(
    "stops after one %s lock connection failure",
    async (code) => {
      const refusal = Object.assign(new Error("synthetic pooler refusal"), {
        code,
      });
      const state = lifecycleHarness();
      state.lockPool.reserve.mockRejectedValueOnce(refusal);
      const callback = vi.fn();

      await expect(
        withGreenfieldTestLock(config(), callback, {
          ...state.options,
        }),
      ).rejects.toBe(refusal);

      expect(state.lockPool.reserve).toHaveBeenCalledOnce();
      expect(callback).not.toHaveBeenCalled();
      expect(state.worker.end).toHaveBeenCalledOnce();
      expect(state.lockPool.end).toHaveBeenCalledOnce();
    },
  );

  it("contains after one pooler authentication failure", async () => {
    const transientFailure = Object.assign(
      new Error("synthetic pooler credential refresh"),
      { code: "28P01" },
    );
    const state = lifecycleHarness({
      authorizations: [transientFailure, true, true],
      initialLogin: false,
    });

    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        ...state.options,
      }),
    ).rejects.toThrow("durable Preview credential was not restored");

    expect(state.events).toEqual([
      "lock",
      "restore",
      "wait-125000",
      "authenticate-0",
      "close-auth",
      "suspend",
      "unlock",
    ]);
    expect(state.credentialClients).toHaveLength(3);
    expect(state.credentialClients[0].end).toHaveBeenCalledOnce();
    expect(state.credentialClients[1].begin).not.toHaveBeenCalled();
    expect(state.credentialClients[2].begin).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not retry transport or provider failures", async () => {
    for (const code of ["28P01", "08006", "ECONNREFUSED", "EDBHANDLEREXITED"]) {
      const failure = Object.assign(new Error(`secret-${code}`), { code });
      const credentialVerifier = vi.fn(async () => {
        throw failure;
      });

      const error = await verifyPreviewCredential(
        config(),
        credentialVerifier,
      ).catch((caught) => caught);

      expect(error.message).toBe(
        "Greenfield TEST durable Preview credential could not authenticate",
      );
      expect(error.message).not.toContain(`secret-${code}`);
      expect(credentialVerifier).toHaveBeenCalledOnce();
    }
  });

  it("contains a restored role whose SCRAM credential invariant is unsafe", async () => {
    const state = lifecycleHarness({
      initialLogin: false,
      restoredCredentialIsSafe: false,
    });

    await expect(
      withGreenfieldTestLock(config(), vi.fn(), {
        ...state.options,
      }),
    ).rejects.toThrow("durable Preview credential was not restored");

    expect(state.roleCanLogin()).toBe(false);
    expect(state.events).toEqual(["lock", "restore", "suspend", "unlock"]);
    expect(state.credentialClients).toHaveLength(2);
    expect(
      state.credentialClients.every(
        ({ begin }) => begin.mock.calls.length === 0,
      ),
    ).toBe(true);
  });

  it("re-suspends when interrupted-state credential recovery cannot authenticate", async () => {
    const state = lifecycleHarness({
      authorizations: [false],
      initialLogin: false,
    });
    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        ...state.options,
      }),
    ).rejects.toThrow("durable Preview credential was not restored");
    expect(callback).not.toHaveBeenCalled();
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events.at(-1)).toBe("unlock");
  });

  it("stays suspended and skips restoration after an operation failure", async () => {
    const operationFailure = new Error("synthetic checkpoint failure");
    const state = lifecycleHarness({ authorizations: [true, false] });

    const error = await withGreenfieldTestLock(
      config(),
      async () => {
        throw operationFailure;
      },
      state.options,
    ).catch((caught) => caught);

    expect(error).toBe(operationFailure);
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events).toEqual([
      "lock",
      "wait-125000",
      "authenticate-0",
      "close-auth",
      "suspend",
      "suspend",
      "unlock",
    ]);
    expect(state.credentialClients[1].begin).not.toHaveBeenCalled();
  });
});
