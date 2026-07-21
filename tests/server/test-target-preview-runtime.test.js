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
        clientFactory: state.clientFactory,
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
        clientFactory: state.clientFactory,
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
        clientFactory: state.clientFactory,
      }),
    ).rejects.toThrow("unsafe Preview role containment failed");

    expect(callback).not.toHaveBeenCalled();
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events.at(-1)).toBe("unlock");
  });

  it("suspends and restores the exact credential before unlocking", async () => {
    const callbackFailure = new Error("synthetic callback failure");
    const state = lifecycleHarness();

    await expect(
      withGreenfieldTestLock(
        config(),
        async ({ recoverRuntimeRole }) => {
          expect(recoverRuntimeRole).toBeTypeOf("function");
          expect(state.roleCanLogin()).toBe(false);
          throw callbackFailure;
        },
        { clientFactory: state.clientFactory },
      ),
    ).rejects.toBe(callbackFailure);

    expect(state.roleCanLogin()).toBe(true);
    expect(state.events).toEqual([
      "lock",
      "authenticate-0",
      "close-auth",
      "suspend",
      "suspend",
      "restore",
      "authenticate-1",
      "close-auth",
      "unlock",
    ]);
    expect(
      state.credentialClients.every(({ end }) => end.mock.calls.length === 1),
    ).toBe(true);
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
      runtimeUrl,
      runtimeUrl,
    ]);
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
        clientFactory: state.clientFactory,
      }),
    ).rejects.toThrow("durable Preview credential could not authenticate");
    expect(callback).not.toHaveBeenCalled();
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events).toEqual([
      "lock",
      "authenticate-0",
      "close-auth",
      "suspend",
      "unlock",
    ]);
  });

  it("recovers an interrupted suspended credential before the checkpoint", async () => {
    const state = lifecycleHarness({ initialLogin: false });

    await withGreenfieldTestLock(
      config(),
      async () => {
        state.events.push("callback");
        expect(state.roleCanLogin()).toBe(false);
      },
      { clientFactory: state.clientFactory },
    );

    expect(state.events).toEqual([
      "lock",
      "restore",
      "authenticate-0",
      "close-auth",
      "suspend",
      "callback",
      "suspend",
      "restore",
      "authenticate-1",
      "close-auth",
      "unlock",
    ]);
    expect(state.roleCanLogin()).toBe(true);
  });

  it("bounds transient session-pooler connection retries before locking", async () => {
    vi.useFakeTimers();
    try {
      const refusal = Object.assign(new Error("synthetic pooler refusal"), {
        code: "08006",
      });
      const state = lifecycleHarness();
      state.lockPool.reserve
        .mockRejectedValueOnce(refusal)
        .mockResolvedValue(state.lockClient);

      const operation = withGreenfieldTestLock(config(), vi.fn(), {
        clientFactory: state.clientFactory,
      });
      await vi.runAllTimersAsync();
      await expect(operation).resolves.toBeUndefined();

      expect(state.lockPool.reserve).toHaveBeenCalledTimes(2);
      expect(state.events[0]).toBe("lock");
      expect(state.events.at(-1)).toBe("unlock");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a transient pooler authentication failure with a fresh client", async () => {
    const transientFailure = Object.assign(
      new Error("synthetic pooler credential refresh"),
      { code: "28P01" },
    );
    const state = lifecycleHarness({
      authorizations: [transientFailure, true, true],
      initialLogin: false,
    });

    await withGreenfieldTestLock(
      config(),
      async () => {
        state.events.push("callback");
      },
      { clientFactory: state.clientFactory },
    );

    expect(state.events).toEqual([
      "lock",
      "restore",
      "authenticate-0",
      "close-auth",
      "authenticate-1",
      "close-auth",
      "suspend",
      "callback",
      "suspend",
      "restore",
      "authenticate-2",
      "close-auth",
      "unlock",
    ]);
    expect(state.credentialClients).toHaveLength(3);
    expect(
      state.credentialClients.every(({ end }) => end.mock.calls.length === 1),
    ).toBe(true);
  });

  it("bounds a hung pooler authentication query without retrying", async () => {
    vi.useFakeTimers();
    try {
      const pendingClient = {
        begin: vi.fn(() => new Promise(() => {})),
        end: vi.fn(async () => {}),
      };
      const clientFactory = vi.fn().mockReturnValueOnce(pendingClient);

      const verification = verifyPreviewCredential(config(), clientFactory);
      const outcome = verification.catch((error) => error);
      await vi.runAllTimersAsync();
      await expect(outcome).resolves.toMatchObject({
        message:
          "Greenfield TEST durable Preview credential could not authenticate",
      });

      expect(clientFactory).toHaveBeenCalledTimes(1);
      expect(pendingClient.begin).toHaveBeenCalledTimes(1);
      expect(pendingClient.end).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry transport or provider failures", async () => {
    for (const code of ["08006", "ECONNREFUSED", "EDBHANDLEREXITED"]) {
      const failure = Object.assign(new Error(`secret-${code}`), { code });
      const client = {
        begin: vi.fn(async () => {
          throw failure;
        }),
        end: vi.fn(async () => {}),
      };
      const clientFactory = vi.fn().mockReturnValue(client);

      const error = await verifyPreviewCredential(
        config(),
        clientFactory,
      ).catch((caught) => caught);

      expect(error.message).toBe(
        "Greenfield TEST durable Preview credential could not authenticate",
      );
      expect(error.message).not.toContain(`secret-${code}`);
      expect(clientFactory).toHaveBeenCalledTimes(1);
      expect(client.end).toHaveBeenCalledTimes(1);
    }
  });

  it("caps wrong-password propagation retries at fifteen seconds", async () => {
    vi.useFakeTimers();
    try {
      const wrongPassword = () =>
        Object.assign(new Error("synthetic protected password"), {
          code: "28P01",
        });
      const clients = [0, 1, 2, 3, 4, 5].map(() => ({
        begin: vi.fn(async () => {
          throw wrongPassword();
        }),
        end: vi.fn(async () => {}),
      }));
      const clientFactory = vi
        .fn()
        .mockReturnValueOnce(clients[0])
        .mockReturnValueOnce(clients[1])
        .mockReturnValueOnce(clients[2])
        .mockReturnValueOnce(clients[3])
        .mockReturnValueOnce(clients[4])
        .mockReturnValueOnce(clients[5]);

      const verification = verifyPreviewCredential(config(), clientFactory);
      const outcome = verification.catch((error) => error);
      await vi.runAllTimersAsync();
      await expect(outcome).resolves.toMatchObject({
        message:
          "Greenfield TEST durable Preview credential could not authenticate",
      });

      expect(clientFactory).toHaveBeenCalledTimes(5);
      for (const client of clients.slice(0, 5)) {
        expect(client.end).toHaveBeenCalledTimes(1);
      }
      expect(clients[5].end).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("contains a restored role whose SCRAM credential invariant is unsafe", async () => {
    const state = lifecycleHarness({
      initialLogin: false,
      restoredCredentialIsSafe: false,
    });

    await expect(
      withGreenfieldTestLock(config(), vi.fn(), {
        clientFactory: state.clientFactory,
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
        clientFactory: state.clientFactory,
      }),
    ).rejects.toThrow("durable Preview credential was not restored");
    expect(callback).not.toHaveBeenCalled();
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events.at(-1)).toBe("unlock");
  });

  it("preserves operation and restoration failures and stays suspended", async () => {
    const operationFailure = new Error("synthetic checkpoint failure");
    const state = lifecycleHarness({ authorizations: [true, false] });

    const error = await withGreenfieldTestLock(
      config(),
      async () => {
        throw operationFailure;
      },
      { clientFactory: state.clientFactory },
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0]).toBe(operationFailure);
    expect(error.errors[1].message).toBe(
      "Greenfield TEST durable Preview credential was not restored",
    );
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events.at(-1)).toBe("unlock");
  });
});
