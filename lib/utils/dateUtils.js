/**
 * Unified Date Utilities for Gioia Beauty
 *
 * This module provides consistent date handling across the entire application.
 * All components should use these utilities to avoid timezone and format inconsistencies.
 */

// ============================================================================
// CORE DATE PARSING - Handles all date formats consistently
// ============================================================================

/**
 * Parse any date input into a proper Date object
 * Handles: Date objects, ISO strings, simple date strings, Firestore timestamps
 */
export const parseDate = (dateInput) => {
  if (!dateInput) {
    return null;
  }

  try {
    // Already a Date object
    if (dateInput instanceof Date) {
      return isNaN(dateInput.getTime()) ? null : dateInput;
    }

    // Firestore Timestamp
    if (dateInput?.toDate && typeof dateInput.toDate === "function") {
      return dateInput.toDate();
    }

    // String inputs
    if (typeof dateInput === "string") {
      // ISO string format: "2025-06-26T10:00:00.000Z"
      if (dateInput.includes("T")) {
        const parsed = new Date(dateInput);
        return isNaN(parsed.getTime()) ? null : parsed;
      }

      // Simple date format: "2025-06-26"
      // Parse as local date to avoid timezone conversion
      const [year, month, day] = dateInput.split("-").map(Number);
      if (year && month && day) {
        const parsed = new Date(year, month - 1, day); // month is 0-indexed
        return isNaN(parsed.getTime()) ? null : parsed;
      }
    }

    // Try direct Date constructor as fallback
    const parsed = new Date(dateInput);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch (error) {
    console.warn("Failed to parse date:", dateInput, error);
    return null;
  }
};

/**
 * Create a local date without timezone conversion
 * Use this when you want June 26 to stay June 26 regardless of timezone
 */
export const createLocalDate = (year, month, day) => {
  return new Date(year, month - 1, day); // month is 0-indexed
};

/**
 * Parse a date string in YYYY-MM-DD format as local date
 */
export const parseDateString = (dateString) => {
  if (!dateString || typeof dateString !== "string") {
    return null;
  }

  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return createLocalDate(year, month, day);
};

// ============================================================================
// DATE FORMATTING - Consistent output formats
// ============================================================================

/**
 * Format date to YYYY-MM-DD string (local date, no timezone conversion)
 */
export const formatDateString = (date) => {
  const parsed = parseDate(date);
  if (!parsed) return "";

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

/**
 * Format date for display (e.g., "June 26, 2025")
 */
export const formatDate = (date, options = {}) => {
  const parsed = parseDate(date);
  if (!parsed) return "";

  const defaultOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...options,
  };

  return parsed.toLocaleDateString("en-US", defaultOptions);
};

/**
 * Format date for short display (e.g., "Jun 26")
 */
export const formatDateShort = (date) => {
  return formatDate(date, { month: "short", day: "numeric" });
};

/**
 * Format time string consistently
 */
export const formatTime = (timeString) => {
  if (!timeString) return "";

  try {
    const [hours, minutes] = timeString.split(":");
    const hour24 = parseInt(hours, 10);
    const minute = parseInt(minutes, 10);

    if (isNaN(hour24) || isNaN(minute)) return timeString;

    const period = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;

    return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
  } catch (error) {
    return timeString;
  }
};

// ============================================================================
// DATE COMPARISON - Consistent comparison logic
// ============================================================================

/**
 * Check if two dates are the same day (ignoring time)
 * Uses local date components to avoid timezone issues
 */
export const isSameDate = (date1, date2) => {
  const parsed1 = parseDate(date1);
  const parsed2 = parseDate(date2);

  if (!parsed1 || !parsed2) return false;

  return (
    parsed1.getFullYear() === parsed2.getFullYear() &&
    parsed1.getMonth() === parsed2.getMonth() &&
    parsed1.getDate() === parsed2.getDate()
  );
};

/**
 * Check if a date is today
 */
export const isToday = (date) => {
  return isSameDate(date, new Date());
};

/**
 * Check if a date is in the past (before today)
 */
export const isPastDate = (date) => {
  const parsed = parseDate(date);
  if (!parsed) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0); // Reset time to beginning of day

  const compareDate = new Date(parsed);
  compareDate.setHours(0, 0, 0, 0);

  return compareDate < today;
};

/**
 * Check if a date is in the future (after today)
 */
export const isFutureDate = (date) => {
  const parsed = parseDate(date);
  if (!parsed) return false;

  const today = new Date();
  today.setHours(23, 59, 59, 999); // Reset time to end of day

  return parsed > today;
};

/**
 * Get the difference in days between two dates
 */
export const getDaysDifference = (date1, date2) => {
  const parsed1 = parseDate(date1);
  const parsed2 = parseDate(date2);

  if (!parsed1 || !parsed2) return 0;

  const diffTime = Math.abs(parsed2 - parsed1);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
};

// ============================================================================
// DATE MANIPULATION - Safe date operations
// ============================================================================

/**
 * Add days to a date
 */
export const addDays = (date, days) => {
  const parsed = parseDate(date);
  if (!parsed) return null;

  const result = new Date(parsed);
  result.setDate(result.getDate() + days);
  return result;
};

/**
 * Subtract days from a date
 */
export const subtractDays = (date, days) => {
  return addDays(date, -days);
};

/**
 * Get the start of day (00:00:00)
 */
export const startOfDay = (date) => {
  const parsed = parseDate(date);
  if (!parsed) return null;

  const result = new Date(parsed);
  result.setHours(0, 0, 0, 0);
  return result;
};

/**
 * Get the end of day (23:59:59)
 */
export const endOfDay = (date) => {
  const parsed = parseDate(date);
  if (!parsed) return null;

  const result = new Date(parsed);
  result.setHours(23, 59, 59, 999);
  return result;
};

// ============================================================================
// APPOINTMENT-SPECIFIC UTILITIES
// ============================================================================

/**
 * Create a standardized appointment date for storage
 * Always stores as local date to avoid timezone issues
 */
export const createAppointmentDate = (dateInput) => {
  const parsed = parseDate(dateInput);
  if (!parsed) return null;

  // Return a new Date object representing the local date
  return createLocalDate(
    parsed.getFullYear(),
    parsed.getMonth() + 1,
    parsed.getDate()
  );
};

/**
 * Get date range for appointment queries
 */
export const getDateRange = (startDate, endDate) => {
  const start = startOfDay(startDate);
  const end = endOfDay(endDate);

  return { start, end };
};

/**
 * Get optimized date range for calendar (today + future only)
 * This reduces database calls by excluding past appointments
 */
export const getFutureOnlyDateRange = (monthsForward = 6) => {
  const today = new Date();
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  const futureDate = new Date(today);
  futureDate.setMonth(today.getMonth() + monthsForward);

  return {
    start: startOfToday.toISOString(),
    end: futureDate.toISOString(),
  };
};

/**
 * Check if an appointment date matches a target date
 * Uses consistent local date comparison
 */
export const appointmentDateMatches = (appointmentDate, targetDate) => {
  return isSameDate(appointmentDate, targetDate);
};

// ============================================================================
// DEBUGGING UTILITIES
// ============================================================================

/**
 * Debug date parsing - helps troubleshoot date issues
 */
export const debugDate = (date, label = "Date") => {
  console.log(`🗓️ ${label} Debug:`, {
    original: date,
    type: typeof date,
    parsed: parseDate(date),
    formatted: formatDateString(date),
    isValid: parseDate(date) !== null,
  });
};

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate if a date string is in correct format
 */
export const isValidDateString = (dateString) => {
  if (!dateString || typeof dateString !== "string") return false;

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) return false;

  const parsed = parseDateString(dateString);
  return parsed !== null && formatDateString(parsed) === dateString;
};

/**
 * Validate if a date is within business days (Monday-Saturday)
 */
export const isBusinessDay = (date) => {
  const parsed = parseDate(date);
  if (!parsed) return false;

  const dayOfWeek = parsed.getDay(); // 0 = Sunday, 6 = Saturday
  return dayOfWeek >= 1 && dayOfWeek <= 6; // Monday to Saturday
};

/**
 * Get the next business day
 */
export const getNextBusinessDay = (date) => {
  let nextDay = addDays(date, 1);

  while (nextDay && !isBusinessDay(nextDay)) {
    nextDay = addDays(nextDay, 1);
  }

  return nextDay;
};

// Timezone-safe date formatting (avoids UTC conversion issues)
export const formatDateForInput = (date) => {
  if (!date) return "";

  let dateObj;

  // Handle different date types
  if (date instanceof Date) {
    dateObj = date;
  } else if (typeof date === "string") {
    dateObj = new Date(date);
  } else if (date?.toDate) {
    // Firestore timestamp
    dateObj = date.toDate();
  } else if (date?.seconds) {
    // Firestore timestamp object
    dateObj = new Date(date.seconds * 1000);
  } else {
    console.warn("Unknown date format for input formatting:", date);
    return "";
  }

  // Validate date
  if (isNaN(dateObj.getTime())) {
    console.warn("Invalid date for input formatting:", date);
    return "";
  }

  // Format using local timezone (no UTC conversion)
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

// Get today's date in YYYY-MM-DD format (timezone-safe)
export const getTodayFormatted = () => {
  return formatDateForInput(new Date());
};
