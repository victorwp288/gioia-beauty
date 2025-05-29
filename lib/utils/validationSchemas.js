import { z } from "zod";

// ============================================================================
// COMMON VALIDATION SCHEMAS
// ============================================================================

// Email validation with proper format and length constraints
export const emailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Invalid email format")
  .max(320, "Email is too long")
  .transform((email) => email.toLowerCase().trim());

// Phone number validation (international format)
export const phoneSchema = z
  .string()
  .min(1, "Phone number is required")
  .regex(/^[\+]?[1-9][\d]{0,15}$/, "Invalid phone number format")
  .max(20, "Phone number is too long");

// Name validation
export const nameSchema = z
  .string()
  .min(1, "Name is required")
  .max(100, "Name is too long")
  .regex(/^[a-zA-ZÀ-ÿ\s'-]+$/, "Name contains invalid characters")
  .transform((name) => name.trim());

// Date validation (ISO string format)
export const dateSchema = z
  .date()
  .refine((date) => !isNaN(date.getTime()), "Invalid date");

// Date string validation (for API inputs)
export const dateStringSchema = z
  .string()
  .refine((dateStr) => !isNaN(Date.parse(dateStr)), "Invalid date format")
  .transform((dateStr) => new Date(dateStr));

// Time validation (HH:MM format)
export const timeSchema = z
  .string()
  .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (use HH:MM)");

// Notes/comments validation
export const notesSchema = z
  .string()
  .max(1000, "Notes are too long")
  .optional()
  .transform((notes) => notes?.trim() || "");

// Duration validation (in minutes)
export const durationSchema = z
  .number()
  .min(15, "Duration must be at least 15 minutes")
  .max(480, "Duration cannot exceed 8 hours")
  .int("Duration must be a whole number");

// ============================================================================
// APPOINTMENT VALIDATION SCHEMAS
// ============================================================================

// Import appointment types for dynamic validation
import { APPOINTMENT_TYPES } from "./constants";

// Get all appointment type names dynamically
const getAppointmentTypeNames = () => {
  return Object.values(APPOINTMENT_TYPES)
    .filter((type) => type.active)
    .map((type) => type.type);
};

// Alternative validation for more flexible appointment types
export const appointmentTypeFlexibleSchema = z.string().refine(
  (value) => {
    const validTypes = getAppointmentTypeNames();
    return validTypes.includes(value);
  },
  {
    message: "Please select a valid appointment type",
  }
);

// Appointment type validation - dynamic based on data files
export const appointmentTypeSchema = appointmentTypeFlexibleSchema;

// Appointment status validation
export const appointmentStatusSchema = z.enum(
  ["pending", "confirmed", "completed", "cancelled", "no_show"],
  {
    errorMap: () => ({ message: "Invalid appointment status" }),
  }
);

// Base appointment data schema
export const appointmentBaseSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  number: phoneSchema,
  appointmentType: appointmentTypeSchema,
  duration: durationSchema,
  selectedDate: dateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  note: notesSchema,
});

// Full appointment schema (includes computed fields)
export const appointmentSchema = appointmentBaseSchema.extend({
  id: z.string().optional(),
  status: appointmentStatusSchema.default("confirmed"),
  variant: z.string().optional(),
  totalDuration: z.number().positive().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  statusNotes: z.string().optional(),
  statusUpdatedAt: z.string().datetime().optional(),
});

// Appointment creation schema (for forms)
export const createAppointmentSchema = appointmentBaseSchema
  .omit({ endTime: true })
  .extend({
    variant: z.string().optional(),
    timeSlot: timeSchema, // For form compatibility
  })
  .refine(
    (data) => {
      // Validate that the selected date is not in the past
      const selectedDate = new Date(data.selectedDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return selectedDate >= today;
    },
    {
      message: "Cannot book appointments for past dates",
      path: ["selectedDate"],
    }
  );

// Appointment update schema
export const updateAppointmentSchema = appointmentSchema
  .partial()
  .omit({ id: true, createdAt: true });

// Appointment query schema (for API filtering)
export const appointmentQuerySchema = z.object({
  dateRange: z
    .object({
      start: dateStringSchema,
      end: dateStringSchema,
    })
    .optional(),
  status: appointmentStatusSchema.optional(),
  appointmentType: appointmentTypeSchema.optional(),
  limit: z.number().min(1).max(1000).default(100),
  offset: z.number().min(0).default(0),
  orderBy: z
    .enum(["selectedDate", "createdAt", "updatedAt"])
    .default("selectedDate"),
  orderDirection: z.enum(["asc", "desc"]).default("asc"),
});

// ============================================================================
// VACATION VALIDATION SCHEMAS
// ============================================================================

// Vacation reason validation
export const vacationReasonSchema = z
  .string()
  .max(500, "Reason is too long")
  .optional()
  .transform((reason) => reason?.trim() || "");

// Base vacation schema
export const vacationBaseSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  reason: vacationReasonSchema,
});

// Full vacation schema
export const vacationSchema = vacationBaseSchema
  .extend({
    id: z.string().optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      // Validate that end date is after start date
      return data.endDate >= data.startDate;
    },
    {
      message: "End date must be after start date",
      path: ["endDate"],
    }
  )
  .refine(
    (data) => {
      // Validate that vacation period is not too long (max 1 year)
      const daysDifference = Math.ceil(
        (data.endDate.getTime() - data.startDate.getTime()) /
          (1000 * 60 * 60 * 24)
      );
      return daysDifference <= 365;
    },
    {
      message: "Vacation period cannot exceed 365 days",
      path: ["endDate"],
    }
  );

// Vacation creation schema
export const createVacationSchema = vacationBaseSchema.refine(
  (data) => {
    // Validate that vacation is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return data.startDate >= today;
  },
  {
    message: "Cannot create vacation periods in the past",
    path: ["startDate"],
  }
);

// Vacation update schema
export const updateVacationSchema = vacationBaseSchema
  .extend({
    id: z.string().optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .partial()
  .omit({ id: true, createdAt: true });

// ============================================================================
// SUBSCRIBER VALIDATION SCHEMAS
// ============================================================================

// Subscriber status validation
export const subscriberStatusSchema = z.enum(
  ["active", "unsubscribed", "bounced", "complained"],
  {
    errorMap: () => ({ message: "Invalid subscriber status" }),
  }
);

// Subscriber source validation
export const subscriberSourceSchema = z
  .enum([
    "website",
    "social_media",
    "referral",
    "bulk_import",
    "manual",
    "newsletter",
    "promotion",
  ])
  .default("website");

// Base subscriber schema
export const subscriberBaseSchema = z.object({
  email: emailSchema,
  name: z
    .string()
    .max(100, "Name is too long")
    .optional()
    .transform((name) => name?.trim() || ""),
  source: subscriberSourceSchema,
});

// Full subscriber schema
export const subscriberSchema = subscriberBaseSchema.extend({
  id: z.string().optional(),
  status: subscriberStatusSchema.default("active"),
  subscribedAt: z.string().datetime().optional(),
  unsubscribedAt: z.string().datetime().optional(),
  statusReason: z.string().optional(),
  statusUpdatedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

// Subscriber creation schema
export const createSubscriberSchema = subscriberBaseSchema;

// Subscriber update schema
export const updateSubscriberSchema = subscriberSchema
  .partial()
  .omit({ id: true, createdAt: true, subscribedAt: true });

// Bulk subscriber schema (for CSV imports)
export const bulkSubscriberSchema = z
  .array(
    z.object({
      email: emailSchema,
      name: z.string().optional(),
    })
  )
  .min(1, "At least one subscriber is required");

// ============================================================================
// CONTACT FORM VALIDATION SCHEMAS
// ============================================================================

// Contact form schema
export const contactFormSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema.optional(),
  subject: z
    .string()
    .min(1, "Subject is required")
    .max(200, "Subject is too long"),
  message: z
    .string()
    .min(10, "Message must be at least 10 characters")
    .max(2000, "Message is too long"),
  consent: z
    .boolean()
    .refine((val) => val === true, "You must agree to the privacy policy"),
});

// Newsletter subscription schema
export const newsletterSubscriptionSchema = z.object({
  email: emailSchema,
  name: z.string().max(100, "Name is too long").optional(),
  source: subscriberSourceSchema.optional(),
  consent: z
    .boolean()
    .refine((val) => val === true, "You must agree to receive newsletters"),
});

// ============================================================================
// USER/ADMIN VALIDATION SCHEMAS
// ============================================================================

// Login schema
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
  remember: z.boolean().optional(),
});

// Password validation
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain at least one uppercase letter, one lowercase letter, and one number"
  );

// Registration schema
export const registrationSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// Password reset schema
export const passwordResetSchema = z.object({
  email: emailSchema,
});

// Password change schema
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// ============================================================================
// SETTINGS VALIDATION SCHEMAS
// ============================================================================

// Business hours schema
export const businessHoursSchema = z.object({
  monday: z.object({ open: timeSchema, close: timeSchema }).nullable(),
  tuesday: z.object({ open: timeSchema, close: timeSchema }).nullable(),
  wednesday: z.object({ open: timeSchema, close: timeSchema }).nullable(),
  thursday: z.object({ open: timeSchema, close: timeSchema }).nullable(),
  friday: z.object({ open: timeSchema, close: timeSchema }).nullable(),
  saturday: z.object({ open: timeSchema, close: timeSchema }).nullable(),
  sunday: z.object({ open: timeSchema, close: timeSchema }).nullable(),
});

// Service configuration schema
export const serviceConfigSchema = z.object({
  name: z
    .string()
    .min(1, "Service name is required")
    .max(100, "Name is too long"),
  durations: z
    .array(durationSchema)
    .min(1, "At least one duration is required"),
  variants: z.array(z.string()).optional(),
  extraTime: z.array(z.number().min(0)).optional(),
  active: z.boolean().default(true),
  price: z.number().min(0).optional(),
  description: z.string().max(500).optional(),
});

// General settings schema
export const settingsSchema = z.object({
  businessName: z.string().min(1, "Business name is required").max(100),
  businessAddress: z.string().min(1, "Address is required").max(200),
  businessPhone: phoneSchema,
  businessEmail: emailSchema,
  timeSlotInterval: z.number().min(5).max(60).default(15),
  maxAdvanceBookingDays: z.number().min(1).max(365).default(30),
  minAdvanceBookingHours: z.number().min(0).max(72).default(2),
  cancellationPolicyHours: z.number().min(0).max(168).default(24),
  emailNotifications: z.boolean().default(true),
  smsNotifications: z.boolean().default(false),
  autoConfirmBookings: z.boolean().default(true),
  requireDeposit: z.boolean().default(false),
  depositAmount: z.number().min(0).optional(),
});

// ============================================================================
// API RESPONSE VALIDATION SCHEMAS
// ============================================================================

// Success response schema
export const successResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  message: z.string().optional(),
  pagination: z
    .object({
      total: z.number(),
      page: z.number(),
      limit: z.number(),
      pages: z.number(),
    })
    .optional(),
});

// Error response schema
export const errorResponseSchema = z.object({
  success: z.boolean().default(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
});

// ============================================================================
// EXPORT UTILITY FUNCTIONS
// ============================================================================

// Validation helper function
export const validateData = (schema, data) => {
  try {
    return {
      success: true,
      data: schema.parse(data),
      errors: null,
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      errors: error.errors || [{ message: error.message }],
    };
  }
};

// Safe validation (doesn't throw)
export const safeValidate = (schema, data) => {
  const result = schema.safeParse(data);
  return {
    success: result.success,
    data: result.success ? result.data : null,
    errors: result.success ? null : result.error.errors,
  };
};

// Partial validation (for updates)
export const validatePartial = (schema, data) => {
  return validateData(schema.partial(), data);
};

// Array validation helper
export const validateArray = (itemSchema, data) => {
  if (!Array.isArray(data)) {
    return {
      success: false,
      data: null,
      errors: [{ message: "Expected an array" }],
    };
  }

  const results = data.map((item, index) => {
    const validation = safeValidate(itemSchema, item);
    return {
      index,
      ...validation,
    };
  });

  const errors = results.filter((r) => !r.success);

  return {
    success: errors.length === 0,
    data: errors.length === 0 ? results.map((r) => r.data) : null,
    errors: errors.length > 0 ? errors : null,
    validItems: results.filter((r) => r.success).map((r) => r.data),
    invalidItems: errors,
  };
};
