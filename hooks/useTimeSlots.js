import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppointmentContext } from "@/context/AppointmentContext";
import {
  generateTimeSlots as generateTimeSlotsUtil,
  getBusinessHoursForDay,
  isTimeSlotAvailable,
  getAvailableTimeSlots,
} from "@/lib/utils/timeUtils";
// import { formatDate } from "@/lib/utils/dateUtils"; // Not needed

export const useTimeSlots = (selectedDate, appointmentType, duration) => {
  const [timeSlots, setTimeSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { appointments, fetchAppointments, vacationPeriods } =
    useAppointmentContext();

  // Get business hours for the selected date
  const businessHours = useMemo(() => {
    if (!selectedDate) return null;
    const dayOfWeek = selectedDate.getDay();
    return getBusinessHoursForDay(dayOfWeek);
  }, [selectedDate]);

  // Filter appointments for the selected date
  const appointmentsForDate = useMemo(() => {
    if (!selectedDate || !appointments?.length) return [];

    // Use timezone-safe date comparison
    const targetYear = selectedDate.getFullYear();
    const targetMonth = selectedDate.getMonth();
    const targetDay = selectedDate.getDate();

    return appointments.filter((apt) => {
      try {
        let appointmentDate;

        // Handle different date formats
        if (typeof apt.selectedDate === "string") {
          if (apt.selectedDate.includes("T")) {
            appointmentDate = new Date(apt.selectedDate);
          } else {
            appointmentDate = new Date(apt.selectedDate + "T00:00:00.000Z");
          }
        } else if (apt.selectedDate instanceof Date) {
          appointmentDate = apt.selectedDate;
        } else if (apt.selectedDate?.toDate) {
          // Firestore Timestamp
          appointmentDate = apt.selectedDate.toDate();
        } else {
          return false;
        }

        // Check if the parsed date is valid
        if (isNaN(appointmentDate.getTime())) return false;

        // Compare using local date components (timezone-safe)
        const aptYear = appointmentDate.getFullYear();
        const aptMonth = appointmentDate.getMonth();
        const aptDay = appointmentDate.getDate();

        const matches =
          targetYear === aptYear &&
          targetMonth === aptMonth &&
          targetDay === aptDay;

        return matches;
      } catch {
        return false;
      }
    });
  }, [selectedDate, appointments]);

  // Stable reference for the date string to prevent unnecessary re-renders
  const selectedDateString = useMemo(() => {
    return selectedDate ? selectedDate.toISOString().split("T")[0] : null;
  }, [selectedDate]);

  // Generate time slots for the current parameters
  const generateTimeSlotsForDate = useCallback(
    async (date, currentAppointments = appointmentsForDate) => {
      if (!date || !duration || !businessHours) {
        setTimeSlots([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const dayOfWeek = date.getDay();

        // Generate available time slots using current appointments
        const availableSlots = getAvailableTimeSlots(
          dayOfWeek,
          duration,
          currentAppointments
        );
        setTimeSlots(availableSlots);
      } catch (err) {
        console.error("Error generating time slots:", err);
        setError("Failed to generate time slots");
        setTimeSlots([]);
      } finally {
        setLoading(false);
      }
    },
    [appointmentsForDate, duration, businessHours]
  );

  // Auto-generate time slots when key parameters change
  useEffect(() => {
    if (selectedDate && duration && businessHours) {
      generateTimeSlotsForDate(selectedDate, appointmentsForDate);
    } else {
      setTimeSlots([]);
    }
  }, [
    selectedDateString,
    selectedDate,
    duration,
    businessHours,
    appointmentsForDate,
    generateTimeSlotsForDate,
  ]);

  // Check if the selected date is available for booking
  const isDateAvailable = useMemo(() => {
    if (!selectedDate || !businessHours) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkDate = new Date(selectedDate);
    checkDate.setHours(0, 0, 0, 0);

    // Must be future date and have business hours
    return checkDate > today && businessHours !== null;
  }, [selectedDate, businessHours]);

  // Refresh function that fetches fresh appointments
  const refreshTimeSlots = useCallback(async () => {
    if (!selectedDate) return;

    try {
      // Fetch fresh appointments for this specific date
      await fetchAppointments({
        dateRange: {
          start: selectedDate,
          end: selectedDate,
        },
      });
    } catch (err) {
      console.error("Error refreshing time slots:", err);
    }
  }, [selectedDate, fetchAppointments]);

  return {
    timeSlots,
    loading,
    error,
    businessHours,
    isDateAvailable,
    generateTimeSlotsForDate,
    refreshTimeSlots,
  };
};
