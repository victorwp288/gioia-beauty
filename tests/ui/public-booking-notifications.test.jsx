import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  PublicBookingNotificationsProvider,
  usePublicBookingNotifications,
} from "@/components/booking/PublicBookingNotifications.jsx";

function NotificationHarness({ operation }) {
  const { notifyAsync, showError } = usePublicBookingNotifications();
  return (
    <>
      <button type="button" onClick={() => showError("Errore accessibile")}>
        Mostra errore
      </button>
      <button
        type="button"
        onClick={() => {
          void notifyAsync(operation, {
            loading: "Caricamento leggero",
            success: "Operazione completata",
            error: (error) => error.message,
          }).catch(() => undefined);
        }}
      >
        Avvia operazione
      </button>
    </>
  );
}

describe("public booking notifications", () => {
  it("announces errors assertively without the dashboard notification system", async () => {
    const user = userEvent.setup();
    render(
      <PublicBookingNotificationsProvider>
        <NotificationHarness operation={() => Promise.resolve()} />
      </PublicBookingNotificationsProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Mostra errore" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Errore accessibile");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("replaces a persistent loading status with the async success result", async () => {
    const user = userEvent.setup();
    const operation = vi.fn().mockResolvedValue({ ok: true });
    render(
      <PublicBookingNotificationsProvider>
        <NotificationHarness operation={operation} />
      </PublicBookingNotificationsProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Avvia operazione" }));

    expect(operation).toHaveBeenCalledOnce();
    const success = await screen.findByText("Operazione completata");
    expect(success).toHaveAttribute("role", "status");
    expect(success).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText("Caricamento leggero")).not.toBeInTheDocument();
  });

  it("announces async failures and preserves rejection semantics", async () => {
    const user = userEvent.setup();
    const operation = vi
      .fn()
      .mockRejectedValue(new Error("Errore del servizio"));
    render(
      <PublicBookingNotificationsProvider>
        <NotificationHarness operation={operation} />
      </PublicBookingNotificationsProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Avvia operazione" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Errore del servizio");
    expect(screen.queryByText("Caricamento leggero")).not.toBeInTheDocument();
  });
});
