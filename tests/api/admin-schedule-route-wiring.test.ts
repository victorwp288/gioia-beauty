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
import * as blockRoute from "@/app/api/admin/blocks/route.ts";
import * as scheduleCancelRoute from "@/app/api/admin/schedule/cancel/route.ts";
import * as vacationCancelRoute from "@/app/api/admin/vacations/cancel/route.ts";
import * as vacationRoute from "@/app/api/admin/vacations/route.ts";

type ConfiguredPost = {
  readonly ownerScheduleCommandName?: string;
};

describe("admin schedule route wiring", () => {
  it.each([
    [appointmentRoute, "createAppointment"],
    [blockRoute, "createBlock"],
    [scheduleCancelRoute, "cancelScheduleEntry"],
    [vacationRoute, "createVacation"],
    [vacationCancelRoute, "cancelVacation"],
  ])("binds each route to its exact command", (route, commandName) => {
    expect((route.POST as ConfiguredPost).ownerScheduleCommandName).toBe(
      commandName,
    );
  });
});
