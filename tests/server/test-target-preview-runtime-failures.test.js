import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_RUNTIME_ROLE_SQL,
  withGreenfieldTestLock,
} from "../../scripts/test-target-harness.mjs";
import {
  config,
  errorText,
  lifecycleHarness,
  PREVIEW_PASSWORD,
  runtimeUrl,
} from "./test-target-preview-runtime-helpers.js";

describe("greenfield TEST Preview runtime containment failures", () => {
  it("contains an unsafe active role and rejects the checkpoint", async () => {
    const state = lifecycleHarness({ attributesAreSafe: false });
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

  it("terminates sessions for an unsafe interrupted suspended role", async () => {
    const state = lifecycleHarness({
      attributesAreSafe: false,
      initialLogin: false,
    });
    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory: state.clientFactory,
      }),
    ).rejects.toThrow("unsafe Preview role containment failed");
    expect(callback).not.toHaveBeenCalled();
    expect(state.lockClient.unsafe).toHaveBeenCalledWith(
      GREENFIELD_RUNTIME_ROLE_SQL.sessions[0],
    );
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events.at(-1)).toBe("unlock");
  });

  it("still terminates unsafe sessions when NOLOGIN cannot be applied", async () => {
    const state = lifecycleHarness({
      attributesAreSafe: false,
      disableFailure: new Error("synthetic alter failure"),
    });
    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory: state.clientFactory,
      }),
    ).rejects.toThrow("unsafe Preview role containment failed");
    expect(callback).not.toHaveBeenCalled();
    expect(state.lockClient.unsafe).toHaveBeenCalledWith(
      GREENFIELD_RUNTIME_ROLE_SQL.sessions[0],
    );
    expect(state.events.at(-1)).toBe("unlock");
  });

  it("does not restore when final zero-session containment fails", async () => {
    const operationFailure = new Error("synthetic checkpoint failure");
    const state = lifecycleHarness({
      authorizations: [true],
      terminateFailureAfter: 2,
    });

    const error = await withGreenfieldTestLock(
      config(),
      async () => {
        throw operationFailure;
      },
      { clientFactory: state.clientFactory },
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0]).toBe(operationFailure);
    expect(error.message).toBe(
      "Greenfield TEST operation and final containment both failed",
    );
    expect(state.events).not.toContain("restore");
    expect(state.roleCanLogin()).toBe(false);
    expect(state.events.at(-1)).toBe("unlock");
  });

  it("redacts authentication and verifier-close failures", async () => {
    const state = lifecycleHarness({
      authorizations: [new Error(runtimeUrl)],
      closeFailures: [new Error(PREVIEW_PASSWORD)],
    });

    const error = await withGreenfieldTestLock(config(), vi.fn(), {
      clientFactory: state.clientFactory,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(errorText(error)).not.toContain(runtimeUrl);
    expect(errorText(error)).not.toContain(PREVIEW_PASSWORD);
    expect(errorText(error)).toContain(
      "Preview authentication and verifier cleanup both failed",
    );
  });

  it("preserves the primary failure while attempting every finalizer", async () => {
    const operationFailure = new Error("synthetic checkpoint failure");
    const secretFailure = () => new Error(runtimeUrl);
    const state = lifecycleHarness({
      cleanupFailures: {
        pool: secretFailure(),
        release: secretFailure(),
        unlock: secretFailure(),
        worker: secretFailure(),
      },
    });

    const error = await withGreenfieldTestLock(
      config(),
      async () => {
        throw operationFailure;
      },
      { clientFactory: state.clientFactory },
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0]).toBe(operationFailure);
    expect(error.errors).toHaveLength(5);
    expect(errorText(error)).not.toContain(runtimeUrl);
    expect(state.worker.end).toHaveBeenCalledOnce();
    expect(state.lockClient.release).toHaveBeenCalledOnce();
    expect(state.lockPool.end).toHaveBeenCalledOnce();
    expect(state.events).toContain("unlock");
  });
});
