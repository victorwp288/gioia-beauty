import { useState, useEffect, useCallback, useRef } from "react";
import { dataManager } from "@/lib/firebase/dataManager";
import { toast } from "react-toastify";
import { invalidateTags } from "@/lib/cache/queryCache";

// Helper function to determine if real-time updates should be enabled
const shouldEnableRealTime = (options, dateRange) => {
  // If explicitly disabled, respect that
  if (options.enableRealTime === false) return false;
  
  // If explicitly enabled, respect that
  if (options.enableRealTime === true) return true;
  
  // Auto-enable for dashboard context (current month view)
  if (dateRange?.start && dateRange?.end) {
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    const today = new Date();
    
    // Enable real-time if date range includes today and spans less than 35 days (month view)
    const includesCurrentDate = start <= today && end >= today;
    const daySpan = Math.floor((end - start) / (1000 * 60 * 60 * 24));
    
    if (includesCurrentDate && daySpan <= 35) {
      console.log("🔄 Auto-enabling real-time for current month dashboard view");
      return true;
    }
  }
  
  return false;
};

// Optimized appointments hook with intelligent caching and real-time sync
export const useOptimizedAppointments = (options = {}) => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Options
  const {
    dateRange = null,
    enableRealTime = null, // null = auto-detect, true/false = explicit
    status = null,
    limit = null,
    autoRefresh = false,
    refreshInterval = 300000, // 5 minutes
  } = options;
  
  // Determine if real-time should be enabled
  const realTimeEnabled = shouldEnableRealTime(options, dateRange);

  // Refs for tracking component state and cleanup
  const listenerRef = useRef(null);
  const refreshIntervalRef = useRef(null);

  // Track initialization to prevent StrictMode duplicates
  const didInitRef = useRef(false);

  // Fetch appointments using optimized data manager
  const fetchAppointments = useCallback(
    async (fetchOptions = {}) => {
      console.log(
        "🎯 HOOK DEBUG: fetchAppointments called with options:",
        fetchOptions
      );

      setLoading(true);
      setError(null);

      try {
        const queryOptions = {
          // Only include dateRange if it's explicitly set in the hook options
          // This allows the Context's smart range logic to work when dateRange is null
          ...(dateRange && { dateRange }),
          ...(status && { status }),
          ...(limit !== undefined && { limit }),
          ...fetchOptions,
        };

        // If fetchOptions.limit is explicitly null, we want all appointments
        if (fetchOptions.limit === null) {
          queryOptions.limit = null;
        }

        // Apply future-only optimization by default to save database reads
        if (!queryOptions.dateRange && !fetchOptions.skipSmartRange) {
          console.log(
            "🎯 HOOK DEBUG: Applying future-only date range optimization..."
          );

          const today = new Date();
          const startOfToday = new Date(today);
          startOfToday.setHours(0, 0, 0, 0);

          // End at the end of current month (much more reasonable for dashboard)
          const endOfCurrentMonth = new Date(
            today.getFullYear(),
            today.getMonth() + 1,
            0
          );
          endOfCurrentMonth.setHours(23, 59, 59, 999);

          queryOptions.dateRange = {
            start: startOfToday.toISOString(),
            end: endOfCurrentMonth.toISOString(),
          };

          console.log("📅 HOOK DEBUG: Current month range applied:", {
            excludingBefore: startOfToday.toISOString().split("T")[0],
            includingUntil: endOfCurrentMonth.toISOString().split("T")[0],
            daysInMonth: Math.ceil(
              (endOfCurrentMonth - today) / (1000 * 60 * 60 * 24)
            ),
          });
        }

        // Handle skipSmartRange for loading all data
        if (fetchOptions.skipSmartRange) {
          console.log("🎯 HOOK DEBUG: Skipping smart range - loading ALL data");
          console.log(
            "🎯 HOOK DEBUG: Expected database total: 1614 appointments"
          );
          queryOptions.dateRange = null; // Remove any date range restrictions
        }

        console.log(
          "🎯 HOOK DEBUG: About to call dataManager with:",
          queryOptions
        );
        const result = await dataManager.getAppointments(queryOptions);

        console.log("🎯 HOOK DEBUG: DataManager returned:", result);

        // Update state if we have valid data
        if (result?.appointments) {
          const appointments = result.appointments;
          console.log(
            "🎯 HOOK DEBUG: Setting appointments:",
            appointments.length
          );

          setAppointments(appointments);
          setLastUpdated(Date.now());

          console.log("🎯 HOOK DEBUG: State updated successfully");
        } else {
          console.log("🎯 HOOK DEBUG: No valid appointments data received");
          setAppointments([]);
        }

        // Return a proper result object
        return {
          appointments: result?.appointments || [],
          total: result?.total || result?.appointments?.length || 0,
          lastDoc: result?.lastDoc || null,
        };
      } catch (err) {
        console.error("🎯 HOOK DEBUG: Error in fetchAppointments:", err);
        setError(err.message);
        toast.error("Failed to fetch appointments. Please try again.");

        // Return empty result on error instead of throwing
        return { appointments: [], total: 0, lastDoc: null };
      } finally {
        setLoading(false);
      }
    },
    [dateRange, status, limit]
  );

  // Get appointments for a specific date (optimized with caching)
  const getAppointmentsByDate = useCallback(async (date) => {
    try {
      const result = await dataManager.getAppointmentsByDate(date);
      return result;
    } catch (err) {
      console.error("Error fetching appointments by date:", err);
      throw err;
    }
  }, []);

  // Create appointment with conflict checking
  const createAppointment = useCallback(async (appointmentData) => {
    setLoading(true);
    setError(null);

    try {
      const result = await dataManager.createAppointmentSafe(appointmentData);

      // Optimistic update for immediate UI feedback
      setAppointments((prev) => [result, ...prev]);
      setLastUpdated(Date.now());

      toast.success("Appointment created successfully");
      return result;
    } catch (err) {
      setError(err.message);
      console.error("Error creating appointment:", err);
      toast.error(
        err.message || "Failed to create appointment. Please try again."
      );
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Update appointment
  const updateAppointment = useCallback(async (appointmentId, updatedData) => {
    setLoading(true);
    setError(null);

    try {
      // Use dataManager instead of legacy AppointmentService
      const { updateDoc, doc } = await import("firebase/firestore");
      const { db, collections } = await import("@/lib/firebase/config");

      const appointmentRef = doc(db, collections.CUSTOMERS, appointmentId);
      const dataWithTimestamp = {
        ...updatedData,
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(appointmentRef, dataWithTimestamp);

      const result = {
        id: appointmentId,
        ...dataWithTimestamp,
      };

      // Optimistic update
      setAppointments((prev) =>
        prev.map((appointment) =>
          appointment.id === appointmentId
            ? {
                ...appointment,
                ...updatedData,
                updatedAt: new Date().toISOString(),
              }
            : appointment
        )
      );
      setLastUpdated(Date.now());

      // Selective cache invalidation based on appointment date
      if (updatedData.selectedDate) {
        let dateObj;
        if (updatedData.selectedDate instanceof Date) {
          dateObj = updatedData.selectedDate;
        } else if (typeof updatedData.selectedDate === 'string') {
          dateObj = new Date(updatedData.selectedDate);
        } else if (updatedData.selectedDate?.toDate) {
          dateObj = updatedData.selectedDate.toDate();
        }
        
        if (dateObj && !isNaN(dateObj.getTime())) {
          const dateStr = dateObj.toISOString().split("T")[0];
          const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
          invalidateTags([`date:${dateStr}`, `appointments-${dateStr}`, `month:${monthKey}`]);
          console.log(`📝 Hook: Selectively invalidated cache for updated appointment on ${dateStr}`);
        } else {
          // Fallback to minimal invalidation
          invalidateTags(["appointments"]);
        }
      } else {
        // Fallback to minimal invalidation
        invalidateTags(["appointments"]);
      }

      toast.success("Appointment updated successfully");
      return result;
    } catch (err) {
      setError(err.message);
      console.error("Error updating appointment:", err);
      toast.error("Failed to update appointment. Please try again.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Delete appointment
  const deleteAppointment = useCallback(async (appointmentId) => {
    setLoading(true);
    setError(null);

    try {
      console.log(
        "🗑️ HOOK: Deleting appointment using dataManager:",
        appointmentId
      );

      // Use dataManager which has proper cache invalidation
      await dataManager.deleteAppointment(appointmentId);

      // Optimistic update
      setAppointments((prev) =>
        prev.filter((appointment) => appointment.id !== appointmentId)
      );
      setLastUpdated(Date.now());

      console.log("🗑️ HOOK: Appointment deleted successfully");

      toast.success("Appointment deleted successfully");
      return true;
    } catch (err) {
      setError(err.message);
      console.error("🗑️ HOOK: Error deleting appointment:", err);
      toast.error("Failed to delete appointment. Please try again.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Batch operations
  const batchCreateAppointments = useCallback(async (appointmentsData) => {
    setLoading(true);
    setError(null);

    try {
      const results = await dataManager.batchCreateAppointments(
        appointmentsData
      );

      // Optimistic update
      setAppointments((prev) => [...results, ...prev]);
      setLastUpdated(Date.now());

      toast.success(`${results.length} appointments created successfully`);
      return results;
    } catch (err) {
      setError(err.message);
      console.error("Error batch creating appointments:", err);
      toast.error("Failed to create appointments. Please try again.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const batchUpdateStatus = useCallback(
    async (appointmentIds, status, notes = "") => {
      setLoading(true);
      setError(null);

      try {
        await dataManager.batchUpdateAppointmentStatus(
          appointmentIds,
          status,
          notes
        );

        // Optimistic update
        setAppointments((prev) =>
          prev.map((appointment) =>
            appointmentIds.includes(appointment.id)
              ? {
                  ...appointment,
                  status,
                  statusNotes: notes,
                  statusUpdatedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }
              : appointment
          )
        );
        setLastUpdated(Date.now());

        toast.success(
          `${appointmentIds.length} appointments updated successfully`
        );
        return true;
      } catch (err) {
        setError(err.message);
        console.error("Error batch updating appointments:", err);
        toast.error("Failed to update appointments. Please try again.");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Check for time conflicts
  const checkTimeConflicts = useCallback(
    async (date, startTime, endTime, excludeId = null) => {
      try {
        return await dataManager.checkTimeConflicts(
          date,
          startTime,
          endTime,
          excludeId
        );
      } catch (err) {
        console.error("Error checking time conflicts:", err);
        throw err;
      }
    },
    []
  );

  // Setup real-time listener if enabled (smart detection)
  useEffect(() => {
    if (realTimeEnabled && dateRange) {
      console.log(
        "🔄 HOOK: Setting up smart real-time listener for dateRange:",
        dateRange,
        "(auto-detected dashboard context)"
      );

      const unsubscribe = dataManager.setupAppointmentListener(
        dateRange,
        (updatedAppointments, error) => {
          if (error) {
            console.error("Real-time listener error:", error);
            setError(error.message);
            return;
          }

          if (updatedAppointments) {
            console.log(
              "🔄 HOOK: Real-time update received:",
              updatedAppointments.length,
              "appointments"
            );
            setAppointments(updatedAppointments);
            setLastUpdated(Date.now());
          }
        }
      );

      listenerRef.current = unsubscribe;

      return () => {
        console.log("🔄 HOOK: Cleaning up real-time listener");
        if (listenerRef.current) {
          listenerRef.current();
          listenerRef.current = null;
        }
      };
    }
  }, [realTimeEnabled, dateRange]);

  // Setup auto-refresh if enabled (but not when real-time is active)
  useEffect(() => {
    if (autoRefresh && !realTimeEnabled) {
      console.log("📊 HOOK: Setting up auto-refresh polling (real-time disabled)");
      
      const interval = setInterval(() => {
        console.log("📊 HOOK: Auto-refresh polling...");
        fetchAppointments();
      }, refreshInterval);

      refreshIntervalRef.current = interval;

      return () => {
        console.log("📊 HOOK: Cleaning up auto-refresh polling");
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
          refreshIntervalRef.current = null;
        }
      };
    }
  }, [autoRefresh, realTimeEnabled, refreshInterval, fetchAppointments]);

  // Initial fetch with StrictMode protection and smart loading
  useEffect(() => {
    if (didInitRef.current) {
      console.log("🎯 HOOK: Already initialized, skipping...");
      return;
    }

    console.log(
      "🎯 HOOK: Initial fetch effect triggered, realTimeEnabled:",
      realTimeEnabled
    );

    // Always do initial fetch to get baseline data, but real-time will update afterward
    console.log("🎯 HOOK: Calling fetchAppointments for initial data");
    didInitRef.current = true;
    fetchAppointments();

    // Cleanup function for React StrictMode
    return () => {
      // In development with StrictMode, this prevents the effect from running twice
      // The ref persists across unmount/remount cycles
    };
  }, [fetchAppointments]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log("🎯 HOOK DEBUG: Component unmounting, cleaning up...");

      if (listenerRef.current) {
        listenerRef.current();
      }

      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  // Get performance metrics
  const getMetrics = useCallback(() => {
    return dataManager.getMetrics();
  }, []);

  console.log(
    "🎯 HOOK: Rendering with",
    appointments.length,
    "appointments, realTimeEnabled:",
    realTimeEnabled
  );

  return {
    // Data
    appointments,
    loading,
    error,
    lastUpdated,

    // Strategy info
    realTimeEnabled,
    usingCache: !realTimeEnabled || (dateRange && appointments.length > 0),

    // Actions
    fetchAppointments,
    getAppointmentsByDate,
    createAppointment,
    updateAppointment,
    deleteAppointment,

    // Batch operations
    batchCreateAppointments,
    batchUpdateStatus,

    // Utilities
    checkTimeConflicts,
    refetch: fetchAppointments,
    getMetrics,
  };
};

// Hook for specific date with enhanced caching
export const useAppointmentsByDate = (date, options = {}) => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { enableRealTime = false, autoRefresh = false } = options;

  const listenerRef = useRef(null);
  const didInitRef = useRef(false); // StrictMode protection

  const fetchAppointments = useCallback(async () => {
    if (!date) return;

    setLoading(true);
    setError(null);

    try {
      const result = await dataManager.getAppointmentsByDate(date);
      setAppointments(result);
      return result;
    } catch (err) {
      setError(err.message);
      console.error("Error fetching appointments by date:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [date]);

  // Setup real-time listener for specific date
  useEffect(() => {
    if (enableRealTime && date) {
      const dateRange = { start: date, end: date };

      const unsubscribe = dataManager.setupAppointmentListener(
        dateRange,
        (updatedAppointments, error) => {
          if (error) {
            console.error("Real-time listener error:", error);
            setError(error.message);
            return;
          }

          if (updatedAppointments) {
            setAppointments(updatedAppointments);
          }
        }
      );

      listenerRef.current = unsubscribe;

      return () => {
        if (listenerRef.current) {
          listenerRef.current();
          listenerRef.current = null;
        }
      };
    }
  }, [enableRealTime, date]);

  // Initial fetch with StrictMode protection
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    if (!enableRealTime) {
      fetchAppointments();
    }

    // Cleanup function for React StrictMode
    return () => {
      // In development with StrictMode, this prevents the effect from running twice
      // The ref persists across unmount/remount cycles
    };
  }, [fetchAppointments, enableRealTime]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (listenerRef.current) {
        listenerRef.current();
      }
    };
  }, []);

  return {
    appointments,
    loading,
    error,
    refetch: fetchAppointments,
  };
};
