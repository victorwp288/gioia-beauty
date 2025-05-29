"use client";
import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { toast } from "react-toastify";

// Import our custom hooks and services
import { useOptimizedAppointments } from "../hooks/useOptimizedAppointments";
// import { useTimeSlots } from "../hooks/useTimeSlots"; // Removed to avoid circular dependency
import { useOptimizedVacations } from "../hooks/useOptimizedVacations";
import { AppointmentService } from "../lib/firebase/appointments";
import { VacationService } from "../lib/firebase/vacations";
import { invalidateAppointmentCache } from "../lib/cache/appointmentCache";
import { APPOINTMENT_STATUS } from "../lib/utils/constants";

// Appointment context state shape
const initialState = {
  // Appointment data
  appointments: [],
  selectedAppointment: null,

  // Loading states
  loading: false,
  appointmentsLoading: false,
  timeSlotLoading: false,
  vacationsLoading: false,

  // Error states
  error: null,
  appointmentError: null,
  timeSlotsError: null,
  vacationsError: null,

  // Form state
  selectedDate: null,
  selectedTimeSlot: null,

  // Time slots and availability
  availableTimeSlots: [],
  conflictingSlots: [],

  // Vacation periods
  vacationPeriods: [],

  // Filter and pagination
  filters: {
    dateRange: null,
    status: null,
    appointmentType: null,
  },
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  },

  // Real-time sync
  lastUpdated: null,
  syncStatus: "idle", // 'idle', 'syncing', 'error'
};

// Action types
const ActionTypes = {
  // Loading actions
  SET_LOADING: "SET_LOADING",
  SET_APPOINTMENTS_LOADING: "SET_APPOINTMENTS_LOADING",
  SET_TIME_SLOTS_LOADING: "SET_TIME_SLOTS_LOADING",
  SET_VACATIONS_LOADING: "SET_VACATIONS_LOADING",

  // Data actions
  SET_APPOINTMENTS: "SET_APPOINTMENTS",
  ADD_APPOINTMENT: "ADD_APPOINTMENT",
  UPDATE_APPOINTMENT: "UPDATE_APPOINTMENT",
  DELETE_APPOINTMENT: "DELETE_APPOINTMENT",
  SELECT_APPOINTMENT: "SELECT_APPOINTMENT",

  // Time slots
  SET_TIME_SLOTS: "SET_TIME_SLOTS",
  SET_CONFLICTING_SLOTS: "SET_CONFLICTING_SLOTS",

  // Date and time selection
  SET_SELECTED_DATE: "SET_SELECTED_DATE",
  SET_SELECTED_TIME_SLOT: "SET_SELECTED_TIME_SLOT",

  // Vacation periods
  SET_VACATION_PERIODS: "SET_VACATION_PERIODS",
  ADD_VACATION_PERIOD: "ADD_VACATION_PERIOD",
  UPDATE_VACATION_PERIOD: "UPDATE_VACATION_PERIOD",
  DELETE_VACATION_PERIOD: "DELETE_VACATION_PERIOD",

  // Error handling
  SET_ERROR: "SET_ERROR",
  SET_APPOINTMENT_ERROR: "SET_APPOINTMENT_ERROR",
  SET_TIME_SLOTS_ERROR: "SET_TIME_SLOTS_ERROR",
  SET_VACATIONS_ERROR: "SET_VACATIONS_ERROR",
  CLEAR_ERRORS: "CLEAR_ERRORS",

  // Filters and pagination
  SET_FILTERS: "SET_FILTERS",
  SET_PAGINATION: "SET_PAGINATION",

  // Sync status
  SET_SYNC_STATUS: "SET_SYNC_STATUS",
  SET_LAST_UPDATED: "SET_LAST_UPDATED",
};

// Reducer function
const appointmentReducer = (state, action) => {
  switch (action.type) {
    case ActionTypes.SET_LOADING:
      return { ...state, loading: action.payload };

    case ActionTypes.SET_APPOINTMENTS_LOADING:
      return { ...state, appointmentsLoading: action.payload };

    case ActionTypes.SET_TIME_SLOTS_LOADING:
      return { ...state, timeSlotLoading: action.payload };

    case ActionTypes.SET_VACATIONS_LOADING:
      return { ...state, vacationsLoading: action.payload };

    case ActionTypes.SET_APPOINTMENTS:
      return {
        ...state,
        appointments: action.payload.appointments || [],
        pagination: {
          ...state.pagination,
          ...action.payload.pagination,
        },
        appointmentsLoading: false,
        appointmentError: null,
        lastUpdated: Date.now(),
      };

    case ActionTypes.ADD_APPOINTMENT:
      return {
        ...state,
        appointments: [action.payload, ...state.appointments],
        lastUpdated: Date.now(),
      };

    case ActionTypes.UPDATE_APPOINTMENT:
      return {
        ...state,
        appointments: state.appointments.map((apt) =>
          apt.id === action.payload.id ? action.payload : apt
        ),
        selectedAppointment:
          state.selectedAppointment?.id === action.payload.id
            ? action.payload
            : state.selectedAppointment,
        lastUpdated: Date.now(),
      };

    case ActionTypes.DELETE_APPOINTMENT:
      return {
        ...state,
        appointments: state.appointments.filter(
          (apt) => apt.id !== action.payload
        ),
        selectedAppointment:
          state.selectedAppointment?.id === action.payload
            ? null
            : state.selectedAppointment,
        lastUpdated: Date.now(),
      };

    case ActionTypes.SELECT_APPOINTMENT:
      return { ...state, selectedAppointment: action.payload };

    case ActionTypes.SET_TIME_SLOTS:
      return {
        ...state,
        availableTimeSlots: action.payload,
        timeSlotLoading: false,
        timeSlotsError: null,
      };

    case ActionTypes.SET_CONFLICTING_SLOTS:
      return { ...state, conflictingSlots: action.payload };

    case ActionTypes.SET_SELECTED_DATE:
      return {
        ...state,
        selectedDate: action.payload,
        selectedTimeSlot: null, // Reset time slot when date changes
        availableTimeSlots: [], // Clear time slots when date changes
      };

    case ActionTypes.SET_SELECTED_TIME_SLOT:
      return { ...state, selectedTimeSlot: action.payload };

    case ActionTypes.SET_VACATION_PERIODS:
      console.log(
        "🏖️ Reducer: SET_VACATION_PERIODS called with:",
        action.payload?.length || 0,
        "vacations"
      );
      return {
        ...state,
        vacationPeriods: action.payload,
        vacationsLoading: false,
        vacationsError: null,
      };

    case ActionTypes.ADD_VACATION_PERIOD:
      return {
        ...state,
        vacationPeriods: [...state.vacationPeriods, action.payload],
        lastUpdated: Date.now(),
      };

    case ActionTypes.UPDATE_VACATION_PERIOD:
      return {
        ...state,
        vacationPeriods: state.vacationPeriods.map((vacation) =>
          vacation.id === action.payload.id ? action.payload : vacation
        ),
        lastUpdated: Date.now(),
      };

    case ActionTypes.DELETE_VACATION_PERIOD:
      return {
        ...state,
        vacationPeriods: state.vacationPeriods.filter(
          (vacation) => vacation.id !== action.payload
        ),
        lastUpdated: Date.now(),
      };

    case ActionTypes.SET_ERROR:
      return { ...state, error: action.payload, loading: false };

    case ActionTypes.SET_APPOINTMENT_ERROR:
      return {
        ...state,
        appointmentError: action.payload,
        appointmentsLoading: false,
      };

    case ActionTypes.SET_TIME_SLOTS_ERROR:
      return {
        ...state,
        timeSlotsError: action.payload,
        timeSlotLoading: false,
      };

    case ActionTypes.SET_VACATIONS_ERROR:
      return {
        ...state,
        vacationsError: action.payload,
        vacationsLoading: false,
      };

    case ActionTypes.CLEAR_ERRORS:
      return {
        ...state,
        error: null,
        appointmentError: null,
        timeSlotsError: null,
        vacationsError: null,
      };

    case ActionTypes.SET_FILTERS:
      return {
        ...state,
        filters: { ...state.filters, ...action.payload },
        pagination: { ...state.pagination, page: 1 }, // Reset to first page when filtering
      };

    case ActionTypes.SET_PAGINATION:
      return {
        ...state,
        pagination: { ...state.pagination, ...action.payload },
      };

    case ActionTypes.SET_SYNC_STATUS:
      return { ...state, syncStatus: action.payload };

    case ActionTypes.SET_LAST_UPDATED:
      return { ...state, lastUpdated: action.payload };

    default:
      return state;
  }
};

// Create context
const AppointmentContext = createContext();

// Custom hook to use the appointment context
export const useAppointmentContext = () => {
  const context = useContext(AppointmentContext);
  if (!context) {
    throw new Error(
      "useAppointmentContext must be used within an AppointmentProvider"
    );
  }
  return context;
};

// Appointment provider component
export const AppointmentProvider = ({ children }) => {
  const [state, dispatch] = useReducer(appointmentReducer, initialState);

  // Track if we've initialized essential data to prevent multiple calls
  const hasInitializedEssentialDataRef = useRef(false);

  // Initialize services
  const appointmentService = new AppointmentService();
  const vacationService = new VacationService();

  // Initialize custom hooks with optimized features
  const appointmentHook = useOptimizedAppointments({
    enableRealTime: false, // DISABLED: Reduce Firebase reads
    autoRefresh: false, // DISABLED: Manual refresh only
  });

  const vacationsHook = useOptimizedVacations({
    enableRealTime: false, // Already disabled
    autoRefresh: false, // DISABLED: Reduce Firebase reads
    refreshInterval: 3600000, // Keep interval for when needed
  });

  // ============================================================================
  // APPOINTMENT OPERATIONS - Using Optimized Hooks
  // ============================================================================

  const fetchAppointments = useCallback(
    async (options = {}) => {
      try {
        console.log("🎯 DEBUGGING: fetchAppointments called with options:", {
          originalOptions: options,
          hasDateRange: !!options.dateRange,
          skipSmartRange: !!options.skipSmartRange,
          limit: options.limit,
        });

        dispatch({ type: ActionTypes.SET_LOADING, payload: true });
        dispatch({ type: ActionTypes.CLEAR_ERRORS });

        // Smart date range loading: If no specific date range is provided,
        // use a reasonable default range for dashboard performance
        let queryOptions = {
          dateRange: options.dateRange,
          status: options.status,
          limit: options.limit !== undefined ? options.limit : null,
        };

        console.log("🎯 DEBUGGING: Before smart range check:", {
          hasDateRange: !!options.dateRange,
          skipSmartRange: !!options.skipSmartRange,
          shouldApplySmartRange: !options.dateRange && !options.skipSmartRange,
        });

        // If no dateRange specified, use smart default for dashboard
        if (!options.dateRange && !options.skipSmartRange) {
          console.log(
            "🎯 DEBUGGING: Applying smart date range (future appointments only)..."
          );

          const today = new Date();
          // Start from today (no past appointments)
          const startOfToday = new Date(today);
          startOfToday.setHours(0, 0, 0, 0);

          // End at 6 months in the future for reasonable coverage
          const sixMonthsForward = new Date(today);
          sixMonthsForward.setMonth(today.getMonth() + 6);

          queryOptions.dateRange = {
            start: startOfToday.toISOString(),
            end: sixMonthsForward.toISOString(),
          };

          console.log("📅 DEBUGGING: Future-only date range calculation:", {
            todayFull: today.toISOString(),
            todayDate: today.toISOString().split("T")[0],
            startOfTodayFull: startOfToday.toISOString(),
            startOfTodayDate: startOfToday.toISOString().split("T")[0],
            sixMonthsForwardFull: sixMonthsForward.toISOString(),
            sixMonthsForwardDate: sixMonthsForward.toISOString().split("T")[0],
            daysForward: Math.ceil(
              (sixMonthsForward - today) / (1000 * 60 * 60 * 24)
            ),
            calculatedRange: {
              start: startOfToday.toISOString().split("T")[0],
              end: sixMonthsForward.toISOString().split("T")[0],
            },
            excludingBefore: startOfToday.toISOString().split("T")[0],
          });

          // Clear any old cached data that might include past appointments
          console.log("🧹 Clearing old appointment cache to ensure past appointments are excluded...");
          try {
            const { clearAppointmentCache } = await import("@/lib/cache/appointmentCache");
            clearAppointmentCache();
            console.log("✅ Old appointment cache cleared");
          } catch (error) {
            console.warn("⚠️ Failed to clear old cache:", error);
          }
        } else {
          console.log("🎯 DEBUGGING: NOT applying smart range because:", {
            hasDateRange: !!options.dateRange,
            skipSmartRange: !!options.skipSmartRange,
            reason: options.dateRange
              ? "dateRange provided"
              : "skipSmartRange is true",
          });
        }

        console.log(
          "🎯 DEBUGGING: Final queryOptions being sent:",
          queryOptions
        );

        // Use optimized hook's fetch method
        const result = await appointmentHook.fetchAppointments(queryOptions);

        // Ensure result exists and has required properties
        const appointments = result?.appointments || [];
        const total = result?.total || appointments.length;

        dispatch({
          type: ActionTypes.SET_APPOINTMENTS,
          payload: {
            appointments,
            pagination: {
              total,
              totalPages: Math.ceil(total / (state.pagination.limit || 10)),
            },
          },
        });

        return { appointments, total };
      } catch (error) {
        console.error("Error fetching appointments:", error);
        dispatch({
          type: ActionTypes.SET_APPOINTMENT_ERROR,
          payload: error?.message || "Failed to fetch appointments",
        });
        toast.error("Failed to fetch appointments");

        // Return empty result instead of throwing to prevent Promise.all failures
        return { appointments: [], total: 0 };
      } finally {
        dispatch({ type: ActionTypes.SET_LOADING, payload: false });
      }
    },
    [appointmentHook, state.pagination.limit]
  );

  const fetchAllAppointments = useCallback(async () => {
    try {
      dispatch({ type: ActionTypes.SET_LOADING, payload: true });
      dispatch({ type: ActionTypes.CLEAR_ERRORS });

      console.log("📊 Loading ALL appointments for comprehensive data...");
      console.log(
        "📊 DEBUG: Current appointments in state:",
        state.appointments.length
      );

      // Explicitly skip smart range and load everything
      const result = await appointmentHook.fetchAppointments({
        skipSmartRange: true,
        limit: null,
      });

      console.log("📊 DEBUG: Raw result from hook:", result);

      const appointments = result?.appointments || [];
      const total = result?.total || appointments.length;

      console.log("📊 DEBUG: Processed appointments:", appointments.length);
      console.log("📊 DEBUG: Total returned:", total);

      dispatch({
        type: ActionTypes.SET_APPOINTMENTS,
        payload: {
          appointments,
          pagination: {
            total,
            totalPages: Math.ceil(total / (state.pagination.limit || 10)),
          },
        },
      });

      console.log(
        "📊 Loaded ALL appointments - Final count:",
        appointments.length
      );
      console.log("📊 Total database records should be: 1614");

      if (appointments.length < 1614) {
        console.warn(
          "⚠️ WARNING: Expected 1614 appointments but only got",
          appointments.length
        );
        console.warn(
          "⚠️ This might indicate date filtering issues or invalid appointment data"
        );
      }

      return { appointments, total };
    } catch (error) {
      console.error("Error fetching all appointments:", error);
      dispatch({
        type: ActionTypes.SET_APPOINTMENT_ERROR,
        payload: error?.message || "Failed to fetch all appointments",
      });
      toast.error("Failed to fetch all appointments");
      return { appointments: [], total: 0 };
    } finally {
      dispatch({ type: ActionTypes.SET_LOADING, payload: false });
    }
  }, [appointmentHook, state.pagination.limit, state.appointments.length]);

  const createAppointment = useCallback(
    async (appointmentData) => {
      try {
        dispatch({ type: ActionTypes.SET_LOADING, payload: true });
        dispatch({ type: ActionTypes.CLEAR_ERRORS });

        // Use optimized hook's create method with conflict checking
        const newAppointment = await appointmentHook.createAppointment(
          appointmentData
        );

        dispatch({
          type: ActionTypes.ADD_APPOINTMENT,
          payload: newAppointment,
        });

        toast.success("Appointment created successfully");
        return newAppointment;
      } catch (error) {
        console.error("Error creating appointment:", error);
        dispatch({ type: ActionTypes.SET_ERROR, payload: error.message });
        toast.error("Failed to create appointment");
        throw error;
      } finally {
        dispatch({ type: ActionTypes.SET_LOADING, payload: false });
      }
    },
    [appointmentHook]
  );

  const updateAppointment = useCallback(
    async (id, updates) => {
      try {
        dispatch({ type: ActionTypes.SET_LOADING, payload: true });
        dispatch({ type: ActionTypes.CLEAR_ERRORS });

        // Use optimized hook's update method
        const updatedAppointment = await appointmentHook.updateAppointment(
          id,
          updates
        );

        dispatch({
          type: ActionTypes.UPDATE_APPOINTMENT,
          payload: updatedAppointment,
        });

        toast.success("Appointment updated successfully");
        return updatedAppointment;
      } catch (error) {
        console.error("Error updating appointment:", error);
        dispatch({ type: ActionTypes.SET_ERROR, payload: error.message });
        toast.error("Failed to update appointment");
        throw error;
      } finally {
        dispatch({ type: ActionTypes.SET_LOADING, payload: false });
      }
    },
    [appointmentHook]
  );

  const deleteAppointment = useCallback(
    async (id) => {
      try {
        dispatch({ type: ActionTypes.SET_LOADING, payload: true });
        dispatch({ type: ActionTypes.CLEAR_ERRORS });

        // Use optimized hook's delete method
        await appointmentHook.deleteAppointment(id);

        dispatch({ type: ActionTypes.DELETE_APPOINTMENT, payload: id });

        toast.success("Appointment deleted successfully");
        return true;
      } catch (error) {
        console.error("Error deleting appointment:", error);
        dispatch({ type: ActionTypes.SET_ERROR, payload: error.message });
        toast.error("Failed to delete appointment");
        throw error;
      } finally {
        dispatch({ type: ActionTypes.SET_LOADING, payload: false });
      }
    },
    [appointmentHook]
  );

  const selectAppointment = useCallback((appointment) => {
    dispatch({ type: ActionTypes.SELECT_APPOINTMENT, payload: appointment });
  }, []);

  // ============================================================================
  // TIME SLOT OPERATIONS
  // ============================================================================

  // Time slots are now handled by individual components using useTimeSlots hook
  // This function is kept for backwards compatibility but delegates to timeUtils
  const fetchTimeSlots = useCallback(
    async (date, appointmentType, duration) => {
      try {
        dispatch({ type: ActionTypes.SET_TIME_SLOTS_LOADING, payload: true });
        dispatch({ type: ActionTypes.CLEAR_ERRORS });

        // Import timeUtils functions directly to avoid circular dependency
        const { getAvailableTimeSlots } = await import("@/lib/utils/timeUtils");

        const dayOfWeek = date.getDay();

        // Get appointments for the date to check availability
        const dateAppointments = state.appointments.filter((apt) => {
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
              appointmentDate = apt.selectedDate.toDate();
            } else {
              return false;
            }

            // Check if the parsed date is valid
            if (isNaN(appointmentDate.getTime())) {
              return false;
            }

            // Use timezone-safe date comparison
            const checkDate = new Date(date);
            const targetYear = checkDate.getFullYear();
            const targetMonth = checkDate.getMonth();
            const targetDay = checkDate.getDate();

            const aptYear = appointmentDate.getFullYear();
            const aptMonth = appointmentDate.getMonth();
            const aptDay = appointmentDate.getDate();

            return (
              targetYear === aptYear &&
              targetMonth === aptMonth &&
              targetDay === aptDay
            );
          } catch (error) {
            console.error(
              "Error filtering appointment for fetchTimeSlots:",
              apt.id,
              error
            );
            return false;
          }
        });

        const timeSlots = getAvailableTimeSlots(
          dayOfWeek,
          duration,
          dateAppointments
        );

        dispatch({ type: ActionTypes.SET_TIME_SLOTS, payload: timeSlots });

        return timeSlots;
      } catch (error) {
        console.error("Error fetching time slots:", error);
        dispatch({
          type: ActionTypes.SET_TIME_SLOTS_ERROR,
          payload: error.message,
        });
        toast.error("Failed to load available time slots");
        throw error;
      }
    },
    [state.appointments]
  );

  const setSelectedDate = useCallback((date) => {
    dispatch({ type: ActionTypes.SET_SELECTED_DATE, payload: date });
  }, []);

  const setSelectedTimeSlot = useCallback((timeSlot) => {
    dispatch({ type: ActionTypes.SET_SELECTED_TIME_SLOT, payload: timeSlot });
  }, []);

  // ============================================================================
  // VACATION OPERATIONS - Using Optimized Hooks
  // ============================================================================

  const fetchVacations = useCallback(async () => {
    console.log("🏖️ AppointmentContext: fetchVacations called");
    console.log("🏖️ AppointmentContext: vacationsHook =", !!vacationsHook);

    try {
      dispatch({ type: ActionTypes.SET_VACATIONS_LOADING, payload: true });
      dispatch({ type: ActionTypes.CLEAR_ERRORS });

      console.log(
        "🏖️ AppointmentContext: Calling vacationsHook.fetchVacations..."
      );
      // Use optimized hook's fetch method
      const vacations = await vacationsHook.fetchVacations();
      console.log("🏖️ AppointmentContext: vacationsHook returned:", vacations);

      console.log(
        "🏖️ AppointmentContext: Dispatching SET_VACATION_PERIODS with:",
        vacations?.length || 0,
        "items"
      );
      dispatch({
        type: ActionTypes.SET_VACATION_PERIODS,
        payload: vacations || [],
      });

      console.log(
        "✅ AppointmentContext: fetchVacations completed successfully"
      );
      return vacations || [];
    } catch (error) {
      console.error("❌ AppointmentContext: Error fetching vacations:", error);
      dispatch({
        type: ActionTypes.SET_VACATIONS_ERROR,
        payload: error?.message || "Failed to fetch vacation periods",
      });
      toast.error("Failed to fetch vacation periods");

      // Return empty result instead of throwing to prevent Promise.all failures
      return [];
    } finally {
      dispatch({ type: ActionTypes.SET_VACATIONS_LOADING, payload: false });
    }
  }, [vacationsHook]);

  const createVacationPeriod = useCallback(
    async (startDate, endDate, reason = "") => {
      console.log("🆕 AppointmentContext: createVacationPeriod called with:", {
        startDate,
        endDate,
        reason,
        vacationsHook: !!vacationsHook,
      });

      try {
        dispatch({ type: ActionTypes.SET_LOADING, payload: true });
        dispatch({ type: ActionTypes.CLEAR_ERRORS });

        console.log(
          "🏖️ AppointmentContext: Calling vacationsHook.createVacation..."
        );
        // Use optimized hook's create method
        const newVacation = await vacationsHook.createVacation(
          startDate,
          endDate,
          reason
        );

        console.log(
          "✅ AppointmentContext: Vacation created, dispatching ADD_VACATION_PERIOD:",
          newVacation
        );

        dispatch({
          type: ActionTypes.ADD_VACATION_PERIOD,
          payload: newVacation,
        });

        toast.success("Vacation period created successfully");
        console.log(
          "✅ AppointmentContext: createVacationPeriod completed successfully"
        );
        return newVacation;
      } catch (error) {
        console.error(
          "❌ AppointmentContext: Error creating vacation period:",
          error
        );
        dispatch({ type: ActionTypes.SET_ERROR, payload: error.message });
        toast.error("Failed to create vacation period");
        throw error;
      } finally {
        dispatch({ type: ActionTypes.SET_LOADING, payload: false });
      }
    },
    [vacationsHook]
  );

  const updateVacationPeriod = useCallback(
    async (id, startDate, endDate, reason = "") => {
      try {
        dispatch({ type: ActionTypes.SET_LOADING, payload: true });
        dispatch({ type: ActionTypes.CLEAR_ERRORS });

        // Use optimized hook's update method
        const updatedVacation = await vacationsHook.updateVacation(
          id,
          startDate,
          endDate,
          reason
        );

        dispatch({
          type: ActionTypes.UPDATE_VACATION_PERIOD,
          payload: updatedVacation,
        });

        toast.success("Vacation period updated successfully");
        return updatedVacation;
      } catch (error) {
        console.error("Error updating vacation period:", error);
        dispatch({ type: ActionTypes.SET_ERROR, payload: error.message });
        toast.error("Failed to update vacation period");
        throw error;
      } finally {
        dispatch({ type: ActionTypes.SET_LOADING, payload: false });
      }
    },
    [vacationsHook]
  );

  const deleteVacationPeriod = useCallback(
    async (id) => {
      try {
        dispatch({ type: ActionTypes.SET_LOADING, payload: true });
        dispatch({ type: ActionTypes.CLEAR_ERRORS });

        // Use optimized hook's delete method
        await vacationsHook.deleteVacation(id);

        dispatch({ type: ActionTypes.DELETE_VACATION_PERIOD, payload: id });

        toast.success("Vacation period deleted successfully");
        return true;
      } catch (error) {
        console.error("Error deleting vacation period:", error);
        dispatch({ type: ActionTypes.SET_ERROR, payload: error.message });
        toast.error("Failed to delete vacation period");
        throw error;
      } finally {
        dispatch({ type: ActionTypes.SET_LOADING, payload: false });
      }
    },
    [vacationsHook]
  );

  // ============================================================================
  // FILTER AND PAGINATION
  // ============================================================================

  const setFilters = useCallback((filters) => {
    dispatch({ type: ActionTypes.SET_FILTERS, payload: filters });
  }, []);

  const setPagination = useCallback((pagination) => {
    dispatch({ type: ActionTypes.SET_PAGINATION, payload: pagination });
  }, []);

  const clearFilters = useCallback(() => {
    dispatch({
      type: ActionTypes.SET_FILTERS,
      payload: {
        dateRange: null,
        status: null,
        appointmentType: null,
      },
    });
  }, []);

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  const clearErrors = useCallback(() => {
    dispatch({ type: ActionTypes.CLEAR_ERRORS });
  }, []);

  const refreshData = useCallback(async () => {
    try {
      dispatch({ type: ActionTypes.SET_SYNC_STATUS, payload: "syncing" });

      await Promise.all([fetchAppointments(), fetchVacations()]);

      dispatch({ type: ActionTypes.SET_SYNC_STATUS, payload: "idle" });
      dispatch({ type: ActionTypes.SET_LAST_UPDATED, payload: Date.now() });
    } catch (error) {
      dispatch({ type: ActionTypes.SET_SYNC_STATUS, payload: "error" });
      console.error("Error refreshing data:", error);
    }
  }, [fetchAppointments, fetchVacations]);

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  // Smart initialization: Load only essential data automatically
  useEffect(() => {
    const initializeEssentialData = async () => {
      if (hasInitializedEssentialDataRef.current) {
        console.log(
          "🏖️ AppointmentContext: Already initialized essential data, skipping..."
        );
        return;
      }

      try {
        hasInitializedEssentialDataRef.current = true;
        console.log(
          "🏖️ AppointmentContext: Loading essential data (vacations) on mount..."
        );

        // Only load vacation periods automatically - they're small, rarely change,
        // and needed by the booking system to disable vacation dates
        await fetchVacations();

        console.log(
          "✅ AppointmentContext: Essential data initialization completed"
        );
      } catch (error) {
        console.error(
          "❌ AppointmentContext: Error initializing essential data:",
          error
        );
        hasInitializedEssentialDataRef.current = false; // Reset on error
      }
    };

    initializeEssentialData();
  }, []); // Empty dependency array is safe here because we use ref to prevent multiple calls

  // Context value
  const contextValue = {
    // State - use appointments directly from the optimized hook to avoid sync issues
    ...state,
    appointments: appointmentHook.appointments || [],
    loading: appointmentHook.loading || state.loading,
    error: appointmentHook.error || state.error,

    // Appointment operations
    fetchAppointments,
    fetchAllAppointments,
    createAppointment,
    updateAppointment,
    deleteAppointment,
    selectAppointment,

    // Time slot operations
    fetchTimeSlots,
    setSelectedDate,
    setSelectedTimeSlot,

    // Vacation operations
    fetchVacations,
    createVacationPeriod,
    updateVacationPeriod,
    deleteVacationPeriod,

    // Filter and pagination
    setFilters,
    setPagination,
    clearFilters,

    // Utilities
    clearErrors,
    refreshData,
  };

  return (
    <AppointmentContext.Provider value={contextValue}>
      {children}
    </AppointmentContext.Provider>
  );
};

export default AppointmentProvider;
