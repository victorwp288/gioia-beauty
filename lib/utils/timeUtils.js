// Time utility functions for Gioia Beauty appointment system

// Business hours configuration
export const BUSINESS_HOURS = {
  1: { open: "09:00", close: "19:00", name: "Monday" }, // Monday
  2: { open: "10:00", close: "20:00", name: "Tuesday" }, // Tuesday
  3: { open: "09:00", close: "19:00", name: "Wednesday" }, // Wednesday
  4: { open: "10:00", close: "20:00", name: "Thursday" }, // Thursday
  5: { open: "09:00", close: "18:30", name: "Friday" }, // Friday
  6: null, // Saturday - Closed
  0: null, // Sunday - Closed
};

// Time slot configuration
export const TIME_SLOT_INTERVAL = 15; // minutes
export const MINIMUM_APPOINTMENT_DURATION = 15; // minutes
export const MAXIMUM_APPOINTMENT_DURATION = 480; // 8 hours

// Common time formats
export const TIME_FORMATS = {
  TWENTY_FOUR_HOUR: "HH:mm",
  TWELVE_HOUR: "h:mm a",
  SHORT: "HH:mm",
  LONG: "HH:mm:ss",
};

// Convert time string (HH:mm) to minutes from midnight
export const timeToMinutes = (timeString) => {
  if (!timeString || typeof timeString !== "string") return 0;

  const [hours, minutes] = timeString.split(":").map(Number);

  if (isNaN(hours) || isNaN(minutes)) return 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return 0;

  return hours * 60 + minutes;
};

// Convert minutes from midnight to time string (HH:mm)
export const minutesToTime = (minutes) => {
  if (typeof minutes !== "number" || minutes < 0) return "00:00";

  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;

  return `${hours.toString().padStart(2, "0")}:${mins
    .toString()
    .padStart(2, "0")}`;
};

// Add minutes to a time string
export const addMinutesToTime = (timeString, minutesToAdd) => {
  const totalMinutes = timeToMinutes(timeString) + minutesToAdd;
  return minutesToTime(totalMinutes);
};

// Subtract minutes from a time string
export const subtractMinutesFromTime = (timeString, minutesToSubtract) => {
  return addMinutesToTime(timeString, -minutesToSubtract);
};

// Calculate the difference between two times in minutes
export const getTimeDifference = (startTime, endTime) => {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  // Handle case where end time is next day
  if (endMinutes < startMinutes) {
    return 24 * 60 - startMinutes + endMinutes;
  }

  return endMinutes - startMinutes;
};

// Check if a time is within business hours for a given day
export const isTimeInBusinessHours = (timeString, dayOfWeek) => {
  const businessHours = BUSINESS_HOURS[dayOfWeek];

  if (!businessHours) return false; // Closed day

  const timeMinutes = timeToMinutes(timeString);
  const openMinutes = timeToMinutes(businessHours.open);
  const closeMinutes = timeToMinutes(businessHours.close);

  return timeMinutes >= openMinutes && timeMinutes < closeMinutes;
};

// Get business hours for a specific day
export const getBusinessHoursForDay = (dayOfWeek) => {
  return BUSINESS_HOURS[dayOfWeek] || null;
};

// Check if a business is open on a specific day
export const isBusinessOpen = (dayOfWeek) => {
  return BUSINESS_HOURS[dayOfWeek] !== null;
};

// Generate time slots for a given day
export const generateTimeSlots = (
  dayOfWeek,
  intervalMinutes = TIME_SLOT_INTERVAL
) => {
  const businessHours = getBusinessHoursForDay(dayOfWeek);

  if (!businessHours) return [];

  const slots = [];
  const openMinutes = timeToMinutes(businessHours.open);
  const closeMinutes = timeToMinutes(businessHours.close);

  for (
    let current = openMinutes;
    current < closeMinutes;
    current += intervalMinutes
  ) {
    slots.push(minutesToTime(current));
  }

  return slots;
};

// Check if two time ranges overlap
export const doTimeRangesOverlap = (start1, end1, start2, end2) => {
  const start1Minutes = timeToMinutes(start1);
  const end1Minutes = timeToMinutes(end1);
  const start2Minutes = timeToMinutes(start2);
  const end2Minutes = timeToMinutes(end2);

  return start1Minutes < end2Minutes && start2Minutes < end1Minutes;
};

// Format time for display
export const formatTime = (
  timeString,
  format = TIME_FORMATS.TWENTY_FOUR_HOUR
) => {
  if (!timeString) return "";

  const [hours, minutes] = timeString.split(":").map(Number);

  if (isNaN(hours) || isNaN(minutes)) return timeString;

  switch (format) {
    case TIME_FORMATS.TWELVE_HOUR:
      const period = hours >= 12 ? "PM" : "AM";
      const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      return `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}`;

    case TIME_FORMATS.SHORT:
    case TIME_FORMATS.TWENTY_FOUR_HOUR:
      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}`;

    case TIME_FORMATS.LONG:
      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:00`;

    default:
      return timeString;
  }
};

// Parse time string from various formats
export const parseTime = (timeString) => {
  if (!timeString) return null;

  // Remove spaces and convert to lowercase
  const cleaned = timeString.trim().toLowerCase();

  // Handle 12-hour format
  if (cleaned.includes("am") || cleaned.includes("pm")) {
    const isPM = cleaned.includes("pm");
    const timeOnly = cleaned.replace(/[ap]m/g, "").trim();
    const [hours, minutes = 0] = timeOnly.split(":").map(Number);

    let adjustedHours = hours;
    if (isPM && hours !== 12) {
      adjustedHours += 12;
    } else if (!isPM && hours === 12) {
      adjustedHours = 0;
    }

    return minutesToTime(adjustedHours * 60 + minutes);
  }

  // Handle 24-hour format
  const [hours, minutes = 0] = cleaned.split(":").map(Number);

  if (isNaN(hours) || isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return minutesToTime(hours * 60 + minutes);
};

// Calculate end time based on start time and duration
export const calculateEndTime = (startTime, durationMinutes) => {
  if (!startTime || !durationMinutes) return null;

  return addMinutesToTime(startTime, durationMinutes);
};

// Validate time string format
export const isValidTime = (timeString) => {
  if (!timeString || typeof timeString !== "string") return false;

  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return timeRegex.test(timeString);
};

// Get the next available time slot
export const getNextAvailableSlot = (
  currentTime,
  intervalMinutes = TIME_SLOT_INTERVAL
) => {
  const currentMinutes = timeToMinutes(currentTime);
  const nextSlotMinutes =
    Math.ceil(currentMinutes / intervalMinutes) * intervalMinutes;

  return minutesToTime(nextSlotMinutes);
};

// Get the previous available time slot
export const getPreviousAvailableSlot = (
  currentTime,
  intervalMinutes = TIME_SLOT_INTERVAL
) => {
  const currentMinutes = timeToMinutes(currentTime);
  const previousSlotMinutes =
    Math.floor(currentMinutes / intervalMinutes) * intervalMinutes;

  return minutesToTime(previousSlotMinutes);
};

// Check if a time slot is available (not overlapping with existing appointments)
export const isTimeSlotAvailable = (
  startTime,
  duration,
  existingAppointments
) => {
  const endTime = calculateEndTime(startTime, duration);

  return !existingAppointments.some((appointment) => {
    return doTimeRangesOverlap(
      startTime,
      endTime,
      appointment.startTime,
      appointment.endTime
    );
  });
};

// Get all available time slots for a day considering existing appointments
export const getAvailableTimeSlots = (
  dayOfWeek,
  duration,
  existingAppointments = []
) => {
  const allSlots = generateTimeSlots(dayOfWeek);

  return allSlots.filter((slot) => {
    const endTime = calculateEndTime(slot, duration);
    const businessHours = getBusinessHoursForDay(dayOfWeek);

    // Check if the entire appointment fits within business hours
    if (
      !businessHours ||
      timeToMinutes(endTime) > timeToMinutes(businessHours.close)
    ) {
      return false;
    }

    // Check if the slot is available
    return isTimeSlotAvailable(slot, duration, existingAppointments);
  });
};

// Round time to nearest interval
export const roundTimeToInterval = (
  timeString,
  intervalMinutes = TIME_SLOT_INTERVAL
) => {
  const totalMinutes = timeToMinutes(timeString);
  const roundedMinutes =
    Math.round(totalMinutes / intervalMinutes) * intervalMinutes;

  return minutesToTime(roundedMinutes);
};

// Get duration between start and end time in minutes
export const getDurationInMinutes = (startTime, endTime) => {
  return getTimeDifference(startTime, endTime);
};

// Format duration in minutes to human readable format
export const formatDuration = (minutes) => {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}min`;
};

// Get business hours summary for display
export const getBusinessHoursSummary = () => {
  const summary = {};

  Object.entries(BUSINESS_HOURS).forEach(([dayOfWeek, hours]) => {
    const dayName = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][dayOfWeek];

    if (hours) {
      summary[dayName] = `${formatTime(hours.open)} - ${formatTime(
        hours.close
      )}`;
    } else {
      summary[dayName] = "Closed";
    }
  });

  return summary;
};

// Check if current time is within business hours
export const isCurrentlyOpen = () => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  return isTimeInBusinessHours(currentTime, dayOfWeek);
};

// Get next opening time
export const getNextOpeningTime = () => {
  const now = new Date();
  let checkDate = new Date(now);

  // Check next 7 days
  for (let i = 0; i < 7; i++) {
    const dayOfWeek = checkDate.getDay();
    const businessHours = getBusinessHoursForDay(dayOfWeek);

    if (businessHours) {
      // If it's today and still within business hours
      if (i === 0) {
        const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now
          .getMinutes()
          .toString()
          .padStart(2, "0")}`;
        if (timeToMinutes(currentTime) < timeToMinutes(businessHours.close)) {
          return {
            date: checkDate,
            time: businessHours.open,
            isToday: true,
          };
        }
      } else {
        return {
          date: checkDate,
          time: businessHours.open,
          isToday: false,
        };
      }
    }

    checkDate.setDate(checkDate.getDate() + 1);
  }

  return null; // No opening hours found in next 7 days
};

// Convert 12-hour format to 24-hour format
export const convertTo24Hour = (time12h) => {
  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":");

  if (hours === "12") {
    hours = "00";
  }

  if (modifier === "PM") {
    hours = parseInt(hours, 10) + 12;
  }

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
};

// Convert 24-hour format to 12-hour format
export const convertTo12Hour = (time24h) => {
  const [hours, minutes] = time24h.split(":");
  const hour24 = parseInt(hours, 10);

  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  const modifier = hour24 >= 12 ? "PM" : "AM";

  return `${hour12}:${minutes} ${modifier}`;
};

// Get time slots with buffer time (e.g., 10 minutes between appointments)
export const getTimeSlotsWithBuffer = (
  dayOfWeek,
  duration,
  bufferMinutes = 10,
  existingAppointments = []
) => {
  const businessHours = getBusinessHoursForDay(dayOfWeek);

  if (!businessHours) return [];

  const slots = [];
  const openMinutes = timeToMinutes(businessHours.open);
  const closeMinutes = timeToMinutes(businessHours.close);
  const totalDuration = duration + bufferMinutes;

  for (
    let current = openMinutes;
    current + totalDuration <= closeMinutes;
    current += TIME_SLOT_INTERVAL
  ) {
    const startTime = minutesToTime(current);
    const endTime = minutesToTime(current + duration);

    // Check if this slot conflicts with existing appointments (including buffer)
    const hasConflict = existingAppointments.some((appointment) => {
      const appointmentStart =
        timeToMinutes(appointment.startTime) - bufferMinutes;
      const appointmentEnd = timeToMinutes(appointment.endTime) + bufferMinutes;

      return current < appointmentEnd && current + duration > appointmentStart;
    });

    if (!hasConflict) {
      slots.push(startTime);
    }
  }

  return slots;
};

// ============================================================================
// BUSINESS DAY UTILITIES
// ============================================================================

// Check if a date is a business day (Monday-Friday, not a weekend)
export const isBusinessDay = (date) => {
  if (!date) return false;

  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  return isBusinessOpen(dayOfWeek);
};

// Get the next business day from a given date
export const getNextBusinessDay = (date) => {
  if (!date) return null;

  let nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);

  // Keep adding days until we find a business day
  while (!isBusinessDay(nextDay)) {
    nextDay.setDate(nextDay.getDate() + 1);
  }

  return nextDay;
};

// Get the previous business day from a given date
export const getPreviousBusinessDay = (date) => {
  if (!date) return null;

  let prevDay = new Date(date);
  prevDay.setDate(prevDay.getDate() - 1);

  // Keep subtracting days until we find a business day
  while (!isBusinessDay(prevDay)) {
    prevDay.setDate(prevDay.getDate() - 1);
  }

  return prevDay;
};

// Check if a date falls within any vacation period
export const isInVacationPeriod = (date, vacationPeriods = []) => {
  if (!date || !Array.isArray(vacationPeriods)) return false;

  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0); // Reset time for date comparison

  return vacationPeriods.some((vacation) => {
    const startDate = new Date(vacation.startDate);
    const endDate = new Date(vacation.endDate);

    // Reset time for accurate date comparison
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    return checkDate >= startDate && checkDate <= endDate;
  });
};

// Get all business days between two dates
export const getBusinessDaysBetween = (startDate, endDate) => {
  if (!startDate || !endDate) return [];

  const businessDays = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    if (isBusinessDay(current)) {
      businessDays.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return businessDays;
};

// Get the number of business days between two dates
export const countBusinessDays = (startDate, endDate) => {
  return getBusinessDaysBetween(startDate, endDate).length;
};

// Add business days to a date (skipping weekends and holidays)
export const addBusinessDays = (date, days) => {
  if (!date || days <= 0) return date;

  let result = new Date(date);
  let daysAdded = 0;

  while (daysAdded < days) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDay(result)) {
      daysAdded++;
    }
  }

  return result;
};

// Check if a date is available for booking (business day + not in vacation)
export const isDateAvailableForBooking = (date, vacationPeriods = []) => {
  return isBusinessDay(date) && !isInVacationPeriod(date, vacationPeriods);
};
