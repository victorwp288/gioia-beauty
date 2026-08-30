import { useCallback } from "react";
import { useForm } from "react-hook-form";

const EMAIL_PATTERN =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

function fieldError(message) {
  return { message, type: "validate" };
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export async function bookingFormResolver(values) {
  const errors = {};
  const name = typeof values.name === "string" ? values.name.trim() : "";
  const number = typeof values.number === "string" ? values.number.trim() : "";
  const email =
    typeof values.email === "string" ? values.email.trim().toLowerCase() : "";

  if (!isValidDate(values.date)) errors.date = fieldError("Date is required");
  if (!name) errors.name = fieldError("Name is required");
  if (!number) errors.number = fieldError("Phone number is required");
  if (!email) {
    errors.email = fieldError("Email is required");
  } else if (email.length > 320) {
    errors.email = fieldError("Email is too long");
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = fieldError("Invalid email format");
  }
  if (typeof values.timeSlot !== "string" || values.timeSlot.length < 1) {
    errors.timeSlot = fieldError("Time slot is required");
  }
  if (!isValidDate(values.selectedDate)) {
    errors.selectedDate = fieldError("Date is required");
  }
  if (
    typeof values.appointmentType !== "string" ||
    values.appointmentType.length < 1
  ) {
    errors.appointmentType = fieldError("Appointment type is required");
  }
  if (
    typeof values.duration !== "number" ||
    !Number.isFinite(values.duration) ||
    values.duration < 1
  ) {
    errors.duration = fieldError("Duration is required");
  }
  if (values.note !== undefined && typeof values.note !== "string") {
    errors.note = fieldError("Invalid note");
  }
  if (values.variant !== undefined && typeof values.variant !== "string") {
    errors.variant = fieldError("Invalid variant");
  }

  if (Object.keys(errors).length > 0) return { errors, values: {} };
  return {
    errors: {},
    values: { ...values, email, name, number },
  };
}

export const useBookingForm = () => {
  const form = useForm({
    resolver: bookingFormResolver,
    defaultValues: {
      date: null,
      note: "",
      name: "",
      number: "",
      email: "",
      timeSlot: "",
      selectedDate: null,
      appointmentType: "",
      variant: "",
      duration: 0,
    },
  });

  const resetForm = useCallback(() => {
    form.reset();
  }, [form]);

  return { form, resetForm };
};
