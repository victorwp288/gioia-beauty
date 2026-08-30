import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastRuntime = vi.hoisted(() => {
  const closeHandlers = new Map();
  const register = vi.fn((_message, options = {}) => {
    closeHandlers.set(options.toastId, options.onClose);
    return options.toastId;
  });
  return {
    closeHandlers,
    toast: Object.assign(register, {
      dismiss: vi.fn((id) => closeHandlers.get(id)?.()),
      error: vi.fn(register),
      info: vi.fn(register),
      loading: vi.fn(register),
      success: vi.fn(register),
      update: vi.fn(),
      warning: vi.fn(register),
    }),
  };
});

vi.mock("react-toastify", () => ({
  toast: toastRuntime.toast,
  ToastContainer: () => null,
}));

import NotificationProvider, {
  useNotification,
} from "@/context/NotificationContext.jsx";

function NotificationHarness() {
  const { alerts, removeToast, showAlert, showLoading, toasts } =
    useNotification();

  return (
    <>
      <p data-testid="notification-counts">
        {toasts.length}:{alerts.length}
      </p>
      <button
        type="button"
        onClick={() => showLoading("Caricamento sintetico")}
      >
        Aggiungi toast
      </button>
      <button
        type="button"
        onClick={() =>
          showAlert("info", "Avviso sintetico", { persistent: true })
        }
      >
        Aggiungi avviso
      </button>
      <button
        type="button"
        disabled={!toasts[0]}
        onClick={() => removeToast(toasts[0].id)}
      >
        Rimuovi toast
      </button>
    </>
  );
}

afterEach(() => {
  toastRuntime.closeHandlers.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("notification cleanup Effect Event", () => {
  it("keeps one cleanup interval while notification state changes", () => {
    const intervalSpy = vi.spyOn(globalThis, "setInterval");

    render(
      <NotificationProvider>
        <NotificationHarness />
      </NotificationProvider>,
    );

    expect(intervalSpy).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi toast" }));
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi avviso" }));

    expect(screen.getByTestId("notification-counts")).toHaveTextContent("1:1");
    expect(intervalSpy).toHaveBeenCalledOnce();
  });

  it("dismisses a toast without recursively dismissing it from onClose", () => {
    render(
      <NotificationProvider>
        <NotificationHarness />
      </NotificationProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi toast" }));
    expect(screen.getByTestId("notification-counts")).toHaveTextContent("1:0");

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Rimuovi toast" })),
    ).not.toThrow();
    expect(toastRuntime.toast.dismiss).toHaveBeenCalledOnce();
    expect(screen.getByTestId("notification-counts")).toHaveTextContent("0:0");
  });
});
