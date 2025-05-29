import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { dataManager } from "@/lib/firebase/dataManager";
import {
  getCachedTimeSlots,
  cacheTimeSlots,
  invalidateTimeSlots,
  clearAppointmentCache,
  getAppointmentCacheStats,
} from "@/lib/cache/appointmentCache";
import {
  generateTimeSlots as generateTimeSlotsUtil,
  getBusinessHoursForDay,
  isTimeSlotAvailable,
  getAvailableTimeSlots,
  isDateAvailableForBooking,
  getTimeSlotsWithBuffer,
} from "@/lib/utils/timeUtils";

// Cache TTL constants
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Simplified optimized time slots hook - basic functionality first
export const useOptimizedTimeSlots = (
  selectedDate,
  appointmentType,
  duration,
  options = {}
) => {
  const [timeSlots, setTimeSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const {
    enableRealTime = false,
    preloadDays = 7,
    bufferMinutes = 0,
  } = options;

  const mountedRef = useRef(true);
  const listenerRef = useRef(null);

  // Initialize mountedRef on component mount
  useEffect(() => {
    mountedRef.current = true;
    console.log("Component mounted, mountedRef set to true");

    // Cleanup only on unmount
    return () => {
      console.log("Component unmounting, setting mountedRef to false");
      mountedRef.current = false;

      // Clean up listener
      if (listenerRef.current && typeof listenerRef.current === "function") {
        try {
          listenerRef.current();
        } catch (err) {
          console.warn("Error cleaning up listener:", err);
        }
        listenerRef.current = null;
      }
    };
  }, []); // Empty dependency array - only run on mount/unmount

  // Get business hours for the selected date
  const businessHours = useMemo(() => {
    if (!selectedDate) return null;
    const dayOfWeek = selectedDate.getDay();
    return getBusinessHoursForDay(dayOfWeek);
  }, [selectedDate]);

  // Check if date is available for booking
  const isDateAvailable = useMemo(() => {
    if (!selectedDate || !businessHours) return false;
    return isDateAvailableForBooking(selectedDate);
  }, [selectedDate, businessHours]);

  // Generate time slots for a specific date - with caching
  const generateTimeSlotsForDate = useCallback(
    async (date, appointmentTypeStr, durationMinutes, bufferTime = 0) => {
      console.log("generateTimeSlotsForDate called with:", {
        date,
        appointmentTypeStr,
        durationMinutes,
        bufferTime,
        businessHours,
      });

      if (!date || !durationMinutes || !businessHours) {
        console.log(
          "Early return from generateTimeSlotsForDate - missing params:",
          {
            hasDate: !!date,
            hasDurationMinutes: !!durationMinutes,
            hasBusinessHours: !!businessHours,
          }
        );
        return [];
      }

      // Convert date to string for caching (use local date, not UTC)
      const dateStr = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      console.log("Using date string for cache:", dateStr);

      // Check cache first (include buffer time in cache key for proper separation)
      const cacheKey =
        bufferTime > 0
          ? `${dateStr}_${appointmentTypeStr}_${durationMinutes}_buffer${bufferTime}`
          : `${dateStr}_${appointmentTypeStr}_${durationMinutes}`;

      const cachedSlots = getCachedTimeSlots(
        cacheKey,
        appointmentTypeStr,
        durationMinutes
      );
      if (cachedSlots) {
        console.log("Returning cached time slots:", cachedSlots);
        return cachedSlots;
      }

      console.log("No cached slots found, generating new ones...");

      try {
        console.log(
          "Generating time slots for:",
          date,
          appointmentTypeStr,
          durationMinutes
        );

        // Get appointments for this date using optimized data manager
        console.log("Calling dataManager.getAppointmentsByDate...");
        const appointmentsForDate = await dataManager.getAppointmentsByDate(
          date
        );

        console.log("Appointments for date:", appointmentsForDate);

        const dayOfWeek = date.getDay();
        console.log("Day of week:", dayOfWeek);

        // Generate available time slots using cached appointment data
        console.log("Calling time slots function with buffer:", bufferTime);

        let availableSlots;
        if (bufferTime > 0) {
          console.log(
            "Using getTimeSlotsWithBuffer with",
            bufferTime,
            "minutes buffer"
          );
          availableSlots = getTimeSlotsWithBuffer(
            dayOfWeek,
            durationMinutes,
            bufferTime,
            appointmentsForDate
          );
        } else {
          console.log("Using getAvailableTimeSlots (no buffer)");
          availableSlots = getAvailableTimeSlots(
            dayOfWeek,
            durationMinutes,
            appointmentsForDate
          );
        }

        console.log("Generated slots:", availableSlots);

        // Cache the results
        cacheTimeSlots(
          cacheKey,
          appointmentTypeStr,
          durationMinutes,
          availableSlots
        );
        console.log(
          "Cached time slots for:",
          cacheKey,
          appointmentTypeStr,
          durationMinutes
        );

        return availableSlots;
      } catch (err) {
        console.error("Error generating time slots:", err);
        throw err;
      }
    },
    [businessHours]
  );

  // Main function to fetch and set time slots - simplified
  const fetchTimeSlots = useCallback(async () => {
    console.log("fetchTimeSlots called with:", {
      selectedDate,
      duration,
      isDateAvailable,
    });
    console.log("appointmentType:", appointmentType);
    console.log("bufferMinutes:", bufferMinutes);
    console.log("mountedRef.current:", mountedRef.current);

    if (!selectedDate || !duration || !isDateAvailable) {
      console.log("Early return due to missing params");
      setTimeSlots([]);
      setLoading(false);
      return;
    }

    if (!mountedRef.current) {
      console.log("Early return due to unmounted component");
      return;
    }

    console.log("Setting loading to true and calling generateTimeSlotsForDate");
    setLoading(true);
    setError(null);

    try {
      const slots = await generateTimeSlotsForDate(
        selectedDate,
        appointmentType,
        duration,
        bufferMinutes
      );

      if (mountedRef.current) {
        console.log("Setting time slots:", slots);
        setTimeSlots(slots);
      }
    } catch (err) {
      if (mountedRef.current) {
        console.error("Error fetching time slots:", err);
        setError("Failed to load available time slots");
        setTimeSlots([]);
      }
    } finally {
      if (mountedRef.current) {
        console.log("Setting loading to false");
        setLoading(false);
      }
    }
  }, [
    selectedDate,
    appointmentType,
    duration,
    bufferMinutes,
    isDateAvailable,
    generateTimeSlotsForDate,
  ]);

  // Setup real-time listener for appointment changes - with cache invalidation
  useEffect(() => {
    if (enableRealTime && selectedDate) {
      const dateRange = { start: selectedDate, end: selectedDate };

      try {
        const unsubscribe = dataManager.setupAppointmentListener(
          dateRange,
          (updatedAppointments, error) => {
            if (error) {
              console.error("Real-time listener error:", error);
              setError(error.message);
              return;
            }

            if (updatedAppointments && mountedRef.current) {
              console.log(
                "Real-time update received, invalidating cache for date:",
                selectedDate
              );

              // Invalidate cache for the affected date
              const dateStr = selectedDate.toISOString().split("T")[0];
              invalidateTimeSlots(dateStr);

              // Regenerate time slots with fresh data
              fetchTimeSlots();
            }
          }
        );

        listenerRef.current = unsubscribe;

        return () => {
          if (
            listenerRef.current &&
            typeof listenerRef.current === "function"
          ) {
            listenerRef.current();
            listenerRef.current = null;
          }
        };
      } catch (err) {
        console.error("Error setting up real-time listener:", err);
        setError("Failed to setup real-time updates");
      }
    }
  }, [enableRealTime, selectedDate, fetchTimeSlots]);

  // Main effect: fetch time slots when dependencies change
  useEffect(() => {
    console.log("Main effect triggered, calling fetchTimeSlots");
    fetchTimeSlots();
  }, [fetchTimeSlots]);

  // Manual refresh function
  const refreshTimeSlots = useCallback(async () => {
    await fetchTimeSlots();
  }, [fetchTimeSlots]);

  // Get time slots for a specific date (useful for calendar views)
  const getTimeSlotsForDate = useCallback(
    async (date) => {
      if (!date || !duration) return [];

      try {
        return await generateTimeSlotsForDate(
          date,
          appointmentType,
          duration,
          bufferMinutes
        );
      } catch (err) {
        console.error("Error getting time slots for date:", err);
        return [];
      }
    },
    [appointmentType, duration, bufferMinutes, generateTimeSlotsForDate]
  );

  // Background preloading for upcoming dates
  const preloadTimeSlots = useCallback(async () => {
    if (!selectedDate || !appointmentType || !duration || preloadDays <= 0) {
      return;
    }

    console.log("Starting background preload for", preloadDays, "days");

    try {
      const preloadPromises = [];

      for (let i = 1; i <= preloadDays; i++) {
        const futureDate = new Date(selectedDate);
        futureDate.setDate(futureDate.getDate() + i);

        // Only preload if date is available for booking
        if (isDateAvailableForBooking(futureDate)) {
          const futureDateStr = `${futureDate.getFullYear()}-${String(
            futureDate.getMonth() + 1
          ).padStart(2, "0")}-${String(futureDate.getDate()).padStart(2, "0")}`;

          // Only preload if not already cached
          if (!getCachedTimeSlots(futureDateStr, appointmentType, duration)) {
            console.log("Preloading time slots for", futureDate.toDateString());
            preloadPromises.push(
              generateTimeSlotsForDate(
                futureDate,
                appointmentType,
                duration,
                bufferMinutes
              ).catch((err) => {
                console.warn(
                  "Failed to preload slots for",
                  futureDate.toDateString(),
                  err
                );
                return []; // Continue with other dates even if one fails
              })
            );
          }
        }
      }

      if (preloadPromises.length > 0) {
        await Promise.all(preloadPromises);
        console.log("Background preloading completed");
      }
    } catch (err) {
      console.warn("Background preloading error:", err);
    }
  }, [
    selectedDate,
    appointmentType,
    duration,
    bufferMinutes,
    preloadDays,
    generateTimeSlotsForDate,
  ]);

  // Trigger preloading when main data is loaded
  useEffect(() => {
    if (!loading && timeSlots.length >= 0 && preloadDays > 0) {
      // Use setTimeout to avoid blocking the main thread
      const preloadTimer = setTimeout(() => {
        preloadTimeSlots();
      }, 100);

      return () => clearTimeout(preloadTimer);
    }
  }, [loading, timeSlots, preloadTimeSlots, preloadDays]);

  return {
    // Data
    timeSlots,
    loading,
    error,
    businessHours,
    isDateAvailable,

    // Actions
    refreshTimeSlots,
    getTimeSlotsForDate,

    // Utilities
    refetch: refreshTimeSlots,
  };
};

// Export optimized cache management utilities
export const timeSlotsUtils = {
  clearCache: () => {
    console.log("Clearing all time slots cache");
    clearAppointmentCache();
  },

  invalidateDate: (dateStr) => {
    console.log("Invalidating cache for date:", dateStr);
    invalidateTimeSlots(dateStr);
  },

  getCacheInfo: () => {
    const cacheStats = getAppointmentCacheStats();
    return {
      system: "optimized",
      status: "active",
      ...cacheStats,
    };
  },

  // Get cache hit rate
  getCacheHitRate: () => {
    const stats = getAppointmentCacheStats();
    return stats.hitRate || 0;
  },

  // Manual cache warming for specific dates
  warmCacheForDates: async (
    dates,
    appointmentType,
    duration,
    bufferMinutes = 0
  ) => {
    console.log("Warming cache for dates:", dates);
    // This would be implemented by the calling component
    return Promise.resolve();
  },
};
