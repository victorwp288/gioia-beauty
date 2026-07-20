import { describe, expect, it, vi } from "vitest";

const createRoute = vi.hoisted(() =>
  vi.fn((commandName: string) =>
    Object.assign(vi.fn(), { ownerScheduleCommandName: commandName }),
  ),
);
const observeRoute = vi.hoisted(() =>
  vi.fn((route: string, method: string, handler: object) =>
    Object.assign(handler, {
      observedMethod: method,
      observedRoute: route,
    }),
  ),
);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/nextOwnerScheduleCommandRoute.ts", () => ({
  createNextOwnerScheduleCommandRoute: createRoute,
}));
vi.mock("@/lib/server/observability/runtime", () => ({
  observeServerRoute: observeRoute,
}));

import * as appointmentRoute from "@/app/api/admin/appointments/route.ts";
import * as appointmentDetailsRoute from "@/app/api/admin/appointments/details/route.ts";
import * as appointmentRescheduleRoute from "@/app/api/admin/appointments/reschedule/route.ts";
import * as appointmentStatusRoute from "@/app/api/admin/appointments/status/route.ts";
import * as blockRoute from "@/app/api/admin/blocks/route.ts";
import * as blockDetailsRoute from "@/app/api/admin/blocks/details/route.ts";
import * as blockRescheduleRoute from "@/app/api/admin/blocks/reschedule/route.ts";
import * as scheduleCancelRoute from "@/app/api/admin/schedule/cancel/route.ts";
import * as vacationCancelRoute from "@/app/api/admin/vacations/cancel/route.ts";
import * as vacationRoute from "@/app/api/admin/vacations/route.ts";
import * as vacationUpdateRoute from "@/app/api/admin/vacations/update/route.ts";

type ConfiguredPost = {
  readonly observedMethod?: string;
  readonly observedRoute?: string;
  readonly ownerScheduleCommandName?: string;
};

describe("admin schedule route wiring", () => {
  it.each([
    [appointmentRoute, "createAppointment", "admin.appointment.create"],
    [appointmentDetailsRoute, "updateAppointment", "admin.appointment.details"],
    [
      appointmentRescheduleRoute,
      "rescheduleAppointment",
      "admin.appointment.reschedule",
    ],
    [
      appointmentStatusRoute,
      "setAppointmentStatus",
      "admin.appointment.status",
    ],
    [blockRoute, "createBlock", "admin.block.create"],
    [blockDetailsRoute, "updateBlock", "admin.block.details"],
    [blockRescheduleRoute, "rescheduleBlock", "admin.block.reschedule"],
    [scheduleCancelRoute, "cancelScheduleEntry", "admin.schedule.cancel"],
    [vacationRoute, "createVacation", "admin.vacation.create"],
    [vacationUpdateRoute, "updateVacation", "admin.vacation.update"],
    [vacationCancelRoute, "cancelVacation", "admin.vacation.cancel"],
  ])(
    "binds each route to its exact command and observation label",
    (route, commandName, observationLabel) => {
      const post = route.POST as ConfiguredPost;
      expect(post.observedRoute).toBe(observationLabel);
      expect(post.observedMethod).toBe("POST");
      expect(post.ownerScheduleCommandName).toBe(commandName);
    },
  );
});
