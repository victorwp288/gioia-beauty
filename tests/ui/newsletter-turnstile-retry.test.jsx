import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/script", () => ({ default: () => null }));
vi.mock("react-toastify", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import NewsletterSignup from "@/components/NewsletterSignup.jsx";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHALLENGE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

let widgetOptions;
const turnstile = {
  remove: vi.fn(),
  render: vi.fn((_selector, options) => {
    widgetOptions = options;
    return "newsletter-widget";
  }),
  reset: vi.fn(),
};

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

beforeEach(() => {
  widgetOptions = undefined;
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
  Object.defineProperty(window, "turnstile", {
    configurable: true,
    value: turnstile,
  });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  delete window.turnstile;
  vi.unstubAllGlobals();
});

describe("Newsletter Turnstile retry", () => {
  it("retries with a fresh proof and the same command idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { code: "HUMAN_VERIFICATION_REQUIRED", requestId: REQUEST_ID },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ code: "REQUEST_ACCEPTED" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<NewsletterSignup />);

    await user.type(
      screen.getByRole("textbox", { name: "Email per la newsletter" }),
      "Cliente@Example.Test",
    );
    await user.click(
      screen.getByRole("button", { name: "Iscriviti alla newsletter" }),
    );

    expect(
      await screen.findByText(
        "Completa la verifica di sicurezza per continuare.",
      ),
    ).toHaveAttribute("role", "status");
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: "Iscriviti alla newsletter" }),
    ).toBeDisabled();

    act(() => widgetOptions.callback(CHALLENGE_TOKEN));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Iscriviti alla newsletter" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Iscriviti alla newsletter" }),
    );
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0][1];
    const secondInit = fetchMock.mock.calls[1][1];
    expect(firstInit.headers["x-gioia-human-challenge"]).toBeUndefined();
    expect(secondInit.headers["x-gioia-human-challenge"]).toBe(CHALLENGE_TOKEN);
    expect(firstInit.headers["Idempotency-Key"]).toBe(
      secondInit.headers["Idempotency-Key"],
    );
    expect(JSON.parse(firstInit.body)).toEqual({
      email: "cliente@example.test",
      consent: true,
    });
    expect(turnstile.remove).toHaveBeenCalledWith("newsletter-widget");
  });
});
