import { describe, expect, it, vi } from "vitest";

const createRoute = vi.hoisted(() =>
  vi.fn((commandName: string) =>
    Object.assign(vi.fn(), { ownerScheduleCommandName: commandName }),
  ),
);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/nextOwnerScheduleCommandRoute.ts", () => ({
  createNextOwnerScheduleCommandRoute: createRoute,
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

type ConfiguredPost = {
  readonly ownerScheduleCommandName?: string;
};

describe("admin schedule route wiring", () => {
  it.each([
    [appointmentRoute, "createAppointment"],
    [appointmentDetailsRoute, "updateAppointment"],
    [appointmentRescheduleRoute, "rescheduleAppointment"],
    [appointmentStatusRoute, "setAppointmentStatus"],
    [blockRoute, "createBlock"],
    [blockDetailsRoute, "updateBlock"],
    [blockRescheduleRoute, "rescheduleBlock"],
    [scheduleCancelRoute, "cancelScheduleEntry"],
    [vacationRoute, "createVacation"],
    [vacationCancelRoute, "cancelVacation"],
  ])("binds each route to its exact command", (route, commandName) => {
    expect((route.POST as ConfiguredPost).ownerScheduleCommandName).toBe(
      commandName,
    );
  });
});
