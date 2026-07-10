import { vi } from "vitest";

import { createBookingEmailPostHandler } from "@/lib/server/bookingEmailHandler";
import { createCancellationEmailPostHandler } from "@/lib/server/cancellationEmailHandler";

export const bookingBody = {
  email: "cliente@example.com",
  name: "Cliente Test",
  startTime: "10:00",
  endTime: "11:00",
  duration: 60,
  date: "10/07/2026",
  appointmentType: "Manicure",
};
export const cancellationBody = {
  email: bookingBody.email,
  name: bookingBody.name,
  startTime: bookingBody.startTime,
  endTime: bookingBody.endTime,
  duration: bookingBody.duration,
  date: bookingBody.date,
};
export const routeCases = [
  {
    label: "booking",
    path: "/api/send",
    body: bookingBody,
    deliveries: 2,
    create: (dependencies) => createBookingEmailPostHandler(dependencies),
  },
  {
    label: "cancellation",
    path: "/api/cancel",
    body: cancellationBody,
    deliveries: 1,
    create: (dependencies) => createCancellationEmailPostHandler(dependencies),
  },
];

export function postRequest(path, body, headers = {}) {
  const requestBody =
    typeof body === "string" ||
    body instanceof Uint8Array ||
    body instanceof ReadableStream
      ? body
      : JSON.stringify(body);
  return new Request(`https://www.gioiabeauty.net${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: requestBody,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}

export function allowedLimiter(check = vi.fn()) {
  check.mockReturnValue({
    allowed: true,
    remaining: 1,
    resetAt: Date.now() + 60_000,
  });
  return { check };
}
