import { z } from "zod";

const requiredText = (field, max) =>
  z
    .string({ error: `${field} is required` })
    .trim()
    .min(1, `${field} is required`)
    .max(max, `${field} is too long`);

const optionalEmail = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().toLowerCase().email().max(320).optional(),
);

const commonEmailFields = {
  email: optionalEmail,
  name: requiredText("name", 100),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  duration: z.number().int().min(1).max(480),
  date: requiredText("date", 64),
};

export const bookingEmailRequestSchema = z
  .object({
    ...commonEmailFields,
    appointmentType: requiredText("appointmentType", 120),
  })
  .strict();

export const cancellationEmailRequestSchema = z
  .object(commonEmailFields)
  .extend({
    email: z.string().trim().toLowerCase().email().max(320),
  })
  .strict();
