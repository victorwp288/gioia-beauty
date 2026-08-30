import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BookAppointment from "@/components/booking/BookAppointment";
import { Calendar } from "@/components/ui/calendar";

vi.mock("next/dynamic", () => ({
  default: (_loader, options = {}) =>
    function DynamicTestStub() {
      return options.loading?.() ?? null;
    },
}));

vi.mock("@/components/booking/PublicBookingNotifications", () => ({
  usePublicBookingNotifications: () => ({
    notifyAsync: vi.fn(),
    showError: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMaintenanceStatus", () => ({
  useMaintenanceStatus: () => ({
    messageCode: "OPERATIONS_OPEN",
    publicBookingEnabled: true,
    unavailable: false,
  }),
}));

vi.mock("@/hooks/useOptimizedTimeSlots", () => ({
  useOptimizedTimeSlots: () => ({
    error: null,
    loading: false,
    refreshTimeSlots: vi.fn(),
    timeSlots: [],
  }),
}));

describe("localized public booking", () => {
  it("renders English labels while keeping canonical catalog IDs as values", () => {
    const { container } = render(<BookAppointment locale="en" />);

    expect(
      screen.getByRole("heading", { name: "Book an appointment" }),
    ).toBeInTheDocument();
    const treatment = screen.getByLabelText("Treatment*");
    expect(treatment).toHaveValue("applicazione-di-smalto-semipermanente");
    expect(
      screen.getByRole("option", { name: "Semi-permanent polish application" }),
    ).toHaveValue("applicazione-di-smalto-semipermanente");
    expect(
      container.querySelector('optgroup[label="Manicure"]'),
    ).not.toBeNull();
    expect(
      screen.queryByText("Prenota un appuntamento"),
    ).not.toBeInTheDocument();
  });

  it("keeps the Italian booking labels on the unprefixed route", () => {
    render(<BookAppointment locale="it" />);

    expect(
      screen.getByRole("heading", { name: "Prenota un appuntamento" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Trattamento*")).toHaveValue(
      "applicazione-di-smalto-semipermanente",
    );
  });

  it("anchors both calendar arrows inside a positioned calendar", () => {
    const { container } = render(
      <Calendar defaultMonth={new Date(2026, 8, 1)} />,
    );

    const root = container.firstElementChild;
    const month = container.querySelector(".relative.w-full.space-y-4");
    const previous = screen.getByRole("button", { name: /previous month/i });
    const next = screen.getByRole("button", { name: /next month/i });

    expect(root).toHaveClass("relative");
    expect(month).not.toBeNull();
    expect(previous).toHaveClass("absolute", "left-3", "top-3");
    expect(next).toHaveClass("absolute", "right-3", "top-3");
  });
});
