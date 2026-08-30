import { describe, expect, it } from "vitest";

import { bookingFormResolver } from "@/hooks/useBookingForm.js";

const validValues = {
  appointmentType: "Massaggio corpo personalizzato",
  date: new Date("2026-08-10T12:00:00.000Z"),
  duration: 60,
  email: " Cliente@Example.Test ",
  name: " Cliente Test ",
  note: "",
  number: " +39000000000 ",
  selectedDate: new Date("2026-08-10T12:00:00.000Z"),
  timeSlot: "10:00",
  variant: "60",
};

describe("booking form resolver", () => {
  it("normalizes the public contact fields without changing booking identity", async () => {
    await expect(bookingFormResolver(validValues)).resolves.toEqual({
      errors: {},
      values: {
        ...validValues,
        email: "cliente@example.test",
        name: "Cliente Test",
        number: "+39000000000",
      },
    });
  });

  it("reports every required or malformed field without accepting partial data", async () => {
    const result = await bookingFormResolver({
      appointmentType: "",
      date: null,
      duration: 0,
      email: "invalid",
      name: " ",
      note: 42,
      number: "",
      selectedDate: new Date("invalid"),
      timeSlot: "",
      variant: false,
    });

    expect(result.values).toEqual({});
    expect(Object.keys(result.errors).sort()).toEqual([
      "appointmentType",
      "date",
      "duration",
      "email",
      "name",
      "note",
      "number",
      "selectedDate",
      "timeSlot",
      "variant",
    ]);
  });

  it("enforces the bounded email contract", async () => {
    const tooLong = await bookingFormResolver({
      ...validValues,
      email: `${"a".repeat(310)}@example.test`,
    });
    expect(tooLong.errors).toMatchObject({
      email: { message: "Email is too long" },
    });
  });
});
