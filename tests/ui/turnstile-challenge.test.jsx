import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/script", () => ({
  default: ({ onError }) => (
    <button type="button" onClick={onError}>
      Simula errore script
    </button>
  ),
}));

import TurnstileChallenge from "@/components/common/TurnstileChallenge.jsx";

const SITE_KEY = "1x00000000000000000000AA";

let widgetOptions;
const turnstile = {
  remove: vi.fn(),
  render: vi.fn((_selector, options) => {
    widgetOptions = options;
    return "widget-1";
  }),
  reset: vi.fn(),
};

beforeEach(() => {
  widgetOptions = undefined;
  Object.defineProperty(window, "turnstile", {
    configurable: true,
    value: turnstile,
  });
});

afterEach(() => {
  delete window.turnstile;
});

describe("TurnstileChallenge", () => {
  it("renders an exact-action accessible widget and manages its lifecycle", async () => {
    const onToken = vi.fn();
    const onUnavailable = vi.fn();
    const view = render(
      <TurnstileChallenge
        action="public_booking"
        onToken={onToken}
        onUnavailable={onUnavailable}
        resetSignal={0}
        siteKey={SITE_KEY}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Verifica di sicurezza" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());
    expect(widgetOptions).toMatchObject({
      action: "public_booking",
      appearance: "interaction-only",
      execution: "render",
      "refresh-expired": "auto",
      retry: "auto",
      sitekey: SITE_KEY,
    });

    act(() => widgetOptions.callback("provider-token"));
    expect(onToken).toHaveBeenLastCalledWith("provider-token");

    view.rerender(
      <TurnstileChallenge
        action="public_booking"
        onToken={onToken}
        onUnavailable={onUnavailable}
        resetSignal={1}
        siteKey={SITE_KEY}
      />,
    );
    expect(turnstile.reset).toHaveBeenCalledWith("widget-1");
    expect(onToken).toHaveBeenLastCalledWith(null);

    act(() => widgetOptions["expired-callback"]());
    expect(onToken).toHaveBeenLastCalledWith(null);

    view.unmount();
    expect(turnstile.remove).toHaveBeenCalledWith("widget-1");
  });

  it("fails closed for widget and script errors", async () => {
    const user = userEvent.setup();
    const onToken = vi.fn();
    const onUnavailable = vi.fn();
    render(
      <TurnstileChallenge
        action="public_newsletter_subscribe"
        onToken={onToken}
        onUnavailable={onUnavailable}
        resetSignal={0}
        siteKey={SITE_KEY}
      />,
    );
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());

    act(() => widgetOptions["error-callback"]());
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(onUnavailable).toHaveBeenCalledOnce();

    await user.click(
      screen.getByRole("button", { name: "Simula errore script" }),
    );
    expect(onUnavailable).toHaveBeenCalledTimes(2);
  });

  it("reports missing or unsupported configuration without rendering", async () => {
    const onUnavailable = vi.fn();
    const { rerender } = render(
      <TurnstileChallenge
        action="public_booking"
        onToken={vi.fn()}
        onUnavailable={onUnavailable}
        resetSignal={0}
      />,
    );
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledOnce());
    expect(turnstile.render).not.toHaveBeenCalled();

    rerender(
      <TurnstileChallenge
        action="owner_login"
        onToken={vi.fn()}
        onUnavailable={onUnavailable}
        resetSignal={0}
        siteKey={SITE_KEY}
      />,
    );
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(2));
    expect(turnstile.render).not.toHaveBeenCalled();
  });
});
