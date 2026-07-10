import type { z } from "zod";

import type {
  AdminCancelScheduleEntryCommandSchema,
  AdminCancelVacationCommandSchema,
  AdminCreateAppointmentCommandSchema,
  AdminCreateBlockCommandSchema,
  AdminCreateVacationCommandSchema,
  AdminRescheduleAppointmentCommandSchema,
  AdminRescheduleBlockCommandSchema,
  AdminRetryOutboxCommandSchema,
  AdminSetAppointmentStatusCommandSchema,
  AdminUpdateAppointmentCommandSchema,
  AdminUpdateBlockCommandSchema,
  PublicBookingCommandSchema,
  PublicCancelAppointmentCommandSchema,
} from "./commands.ts";

export type PublicBookingCommand = z.infer<typeof PublicBookingCommandSchema>;
export type AdminCreateAppointmentCommand = z.infer<
  typeof AdminCreateAppointmentCommandSchema
>;
export type AdminCreateBlockCommand = z.infer<
  typeof AdminCreateBlockCommandSchema
>;
export type AdminUpdateAppointmentCommand = z.infer<
  typeof AdminUpdateAppointmentCommandSchema
>;
export type AdminUpdateBlockCommand = z.infer<
  typeof AdminUpdateBlockCommandSchema
>;
export type AdminRescheduleAppointmentCommand = z.infer<
  typeof AdminRescheduleAppointmentCommandSchema
>;
export type AdminRescheduleBlockCommand = z.infer<
  typeof AdminRescheduleBlockCommandSchema
>;
export type AdminCancelScheduleEntryCommand = z.infer<
  typeof AdminCancelScheduleEntryCommandSchema
>;
export type AdminSetAppointmentStatusCommand = z.infer<
  typeof AdminSetAppointmentStatusCommandSchema
>;
export type AdminCreateVacationCommand = z.infer<
  typeof AdminCreateVacationCommandSchema
>;
export type AdminCancelVacationCommand = z.infer<
  typeof AdminCancelVacationCommandSchema
>;
export type PublicCancelAppointmentCommand = z.infer<
  typeof PublicCancelAppointmentCommandSchema
>;
export type AdminRetryOutboxCommand = z.infer<
  typeof AdminRetryOutboxCommandSchema
>;
