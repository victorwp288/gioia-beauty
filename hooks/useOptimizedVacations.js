import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { dataManager } from "@/lib/firebase/dataManager";
import { toast } from "react-toastify";
import {
  cacheQuery,
  getCachedQuery,
  invalidateNamespace,
  invalidateTags,
} from "@/lib/cache/queryCache";

// Optimized vacations hook with extended caching and batch operations
export const useOptimizedVacations = (options = {}) => {
  const [vacations, setVacations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const {
    includeExpired = false,
    enableRealTime = false,
    autoRefresh = false,
    refreshInterval = 3600000, // 1 hour (vacations change rarely)
  } = options;

  const mountedRef = useRef(true);
  const listenerRef = useRef(null);
  const refreshIntervalRef = useRef(null);

  // Track initialization to prevent StrictMode duplicates
  const didInitRef = useRef(false);

  // Fetch vacations using optimized data manager
  const fetchVacations = useCallback(
    async (fetchOptions = {}) => {
      console.log(
        "🏖️ useOptimizedVacations: fetchVacations called with options:",
        fetchOptions
      );
      console.log(
        "🏖️ useOptimizedVacations: mountedRef.current =",
        mountedRef.current
      );

      setLoading(true);
      setError(null);
      console.log(
        "🏖️ useOptimizedVacations: Set loading to true, calling dataManager..."
      );

      try {
        const queryOptions = {
          includeExpired,
          ...fetchOptions,
        };

        console.log(
          "🏖️ useOptimizedVacations: Calling dataManager.getVacations with:",
          queryOptions
        );
        const result = await dataManager.getVacations(queryOptions);
        console.log("🏖️ useOptimizedVacations: DataManager returned:", result);

        // Always update state and return data - let the caller handle the result
        console.log(
          "🏖️ useOptimizedVacations: Setting vacations state:",
          result.length,
          "items"
        );
        setVacations(result);
        setLastUpdated(Date.now());
        console.log("✅ useOptimizedVacations: State updated successfully");

        // Cache with shorter TTL (5 minutes) for fresher data
        cacheQuery("vacations", "list", options, vacations, {
          ttl: 5 * 60 * 1000, // 5 minutes
          tags: ["vacations"],
        });

        return result;
      } catch (err) {
        if (mountedRef.current) {
          setError(err.message);
          console.error(
            "❌ useOptimizedVacations: Error fetching vacations:",
            err
          );
          toast.error("Failed to fetch vacation periods. Please try again.");
        }
        throw err;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          console.log("🏖️ useOptimizedVacations: Set loading to false");
        }
      }
    },
    [includeExpired, options, vacations]
  );

  // Create vacation period
  const createVacation = useCallback(
    async (startDate, endDate, reason = "") => {
      console.log(
        "🆕 useOptimizedVacations: Starting vacation creation with:",
        {
          startDate,
          endDate,
          reason,
          mountedRef: mountedRef.current,
        }
      );

      setLoading(true);
      setError(null);

      try {
        // Use existing service for vacation operations
        console.log("📦 useOptimizedVacations: Importing VacationService...");
        const { VacationService } = await import("@/lib/firebase/vacations");
        const vacationService = new VacationService();

        console.log("🏖️ useOptimizedVacations: Calling createVacationSafe...");
        const result = await vacationService.createVacationSafe(
          startDate,
          endDate,
          reason
        );

        console.log(
          "✅ useOptimizedVacations: Vacation created successfully:",
          result
        );

        // Optimistic update
        if (mountedRef.current) {
          console.log(
            "🔄 useOptimizedVacations: Applying optimistic update for create..."
          );
          setVacations((prev) => {
            const newList = [...prev, result].sort(
              (a, b) => new Date(a.startDate) - new Date(b.startDate)
            );
            console.log("🔄 New vacation list length:", newList.length);
            return newList;
          });
          setLastUpdated(Date.now());
          console.log("🔄 Optimistic update completed for create");
        } else {
          console.error(
            "❌ Create optimistic update skipped - component unmounted!"
          );
        }

        // Invalidate related caches
        console.log("🗑️ Invalidating caches after create...");
        invalidateTags("vacations", "appointments"); // Time slots depend on vacations

        toast.success("Vacation period created successfully");
        return result;
      } catch (err) {
        console.error(
          "❌ useOptimizedVacations: Error creating vacation:",
          err
        );
        if (mountedRef.current) {
          setError(err.message);
        }
        console.error("Error creating vacation:", err);
        toast.error(
          err.message || "Failed to create vacation period. Please try again."
        );
        throw err;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
        console.log("🔚 useOptimizedVacations: Create vacation completed");
      }
    },
    []
  );

  // Update vacation period
  const updateVacation = useCallback(
    async (id, startDate, endDate, reason = "") => {
      setLoading(true);
      setError(null);

      console.log(
        "🔄 useOptimizedVacations: Starting update for vacation:",
        id
      );

      try {
        // Invalidate cache before update to ensure fresh data
        console.log("🗑️ Invalidating vacation cache before update...");
        invalidateTags("vacations");

        const { VacationService } = await import("@/lib/firebase/vacations");
        const vacationService = new VacationService();

        const result = await vacationService.updateVacation(
          id,
          startDate,
          endDate,
          reason
        );

        console.log(
          "🔄 useOptimizedVacations: Update result from service:",
          result
        );

        // Optimistic update with current state
        console.log(
          "🔄 useOptimizedVacations: mountedRef.current =",
          mountedRef.current
        );
        if (mountedRef.current) {
          console.log(
            "🔄 useOptimizedVacations: Applying optimistic update..."
          );
          setVacations((prevVacations) => {
            console.log(
              "🔄 Previous vacations in setter:",
              prevVacations.length,
              prevVacations
            );

            const vacationExists = prevVacations.find((v) => v.id === id);
            console.log(
              "🔄 Vacation exists in current list:",
              !!vacationExists
            );

            if (!vacationExists) {
              console.warn("⚠️ Vacation to update not found in current list!");
              // Add it to the list instead of trying to update
              const newList = [...prevVacations, result].sort(
                (a, b) => new Date(a.startDate) - new Date(b.startDate)
              );
              console.log(
                "🔄 Adding vacation to list, new count:",
                newList.length
              );
              return newList;
            }

            const updated = prevVacations
              .map((vacation) => {
                if (vacation.id === id) {
                  console.log(
                    "🔄 Replacing vacation:",
                    vacation,
                    "with:",
                    result
                  );
                  return result;
                }
                return vacation;
              })
              .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

            console.log("🔄 Updated vacations array:", updated);
            return updated;
          });
          setLastUpdated(Date.now());
          console.log("🔄 Optimistic update completed");
        } else {
          console.error("❌ Optimistic update skipped - component unmounted!");
        }

        // Invalidate related caches
        invalidateTags("vacations", "appointments");

        toast.success("Vacation period updated successfully");
        return result;
      } catch (err) {
        if (mountedRef.current) {
          setError(err.message);
        }
        console.error("Error updating vacation:", err);
        toast.error("Failed to update vacation period. Please try again.");
        throw err;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [] // Removed vacations dependency to avoid stale closure
  );

  // Delete vacation period
  const deleteVacation = useCallback(async (id) => {
    setLoading(true);
    setError(null);

    try {
      const { VacationService } = await import("@/lib/firebase/vacations");
      const vacationService = new VacationService();

      await vacationService.deleteVacation(id);

      // Optimistic update
      if (mountedRef.current) {
        setVacations((prev) => prev.filter((vacation) => vacation.id !== id));
        setLastUpdated(Date.now());
      }

      // Invalidate related caches
      invalidateTags("vacations", "appointments");

      toast.success("Vacation period deleted successfully");
      return true;
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
      }
      console.error("Error deleting vacation:", err);
      toast.error("Failed to delete vacation period. Please try again.");
      throw err;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Batch operations for admin efficiency
  const batchCreateVacations = useCallback(async (vacationsData) => {
    setLoading(true);
    setError(null);

    try {
      const { VacationService } = await import("@/lib/firebase/vacations");
      const vacationService = new VacationService();

      const results = await vacationService.batchCreateVacations(vacationsData);

      // Optimistic update
      if (mountedRef.current) {
        setVacations((prev) =>
          [...prev, ...results].sort(
            (a, b) => new Date(a.startDate) - new Date(b.startDate)
          )
        );
        setLastUpdated(Date.now());
      }

      // Invalidate related caches
      invalidateTags("vacations", "appointments");

      toast.success(`${results.length} vacation periods created successfully`);
      return results;
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
      }
      console.error("Error batch creating vacations:", err);
      toast.error("Failed to create vacation periods. Please try again.");
      throw err;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const batchDeleteVacations = useCallback(async (ids) => {
    setLoading(true);
    setError(null);

    try {
      const { VacationService } = await import("@/lib/firebase/vacations");
      const vacationService = new VacationService();

      await vacationService.batchDeleteVacations(ids);

      // Optimistic update
      if (mountedRef.current) {
        setVacations((prev) =>
          prev.filter((vacation) => !ids.includes(vacation.id))
        );
        setLastUpdated(Date.now());
      }

      // Invalidate related caches
      invalidateTags("vacations", "appointments");

      toast.success(`${ids.length} vacation periods deleted successfully`);
      return true;
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
      }
      console.error("Error batch deleting vacations:", err);
      toast.error("Failed to delete vacation periods. Please try again.");
      throw err;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Utility functions
  const getCurrentVacation = useCallback(() => {
    const now = new Date();
    return vacations.find((vacation) => {
      const start = new Date(vacation.startDate);
      const end = new Date(vacation.endDate);
      return now >= start && now <= end;
    });
  }, [vacations]);

  const getUpcomingVacations = useCallback(
    (withinDays = 30) => {
      const now = new Date();
      const futureDate = new Date();
      futureDate.setDate(now.getDate() + withinDays);

      return vacations.filter((vacation) => {
        const start = new Date(vacation.startDate);
        return start > now && start <= futureDate;
      });
    },
    [vacations]
  );

  const isDateInVacation = useCallback(
    (date) => {
      const checkDate = new Date(date);
      return vacations.some((vacation) => {
        const start = new Date(vacation.startDate);
        const end = new Date(vacation.endDate);
        return checkDate >= start && checkDate <= end;
      });
    },
    [vacations]
  );

  const getVacationsInRange = useCallback(
    (startDate, endDate) => {
      const start = new Date(startDate);
      const end = new Date(endDate);

      return vacations.filter((vacation) => {
        const vacStart = new Date(vacation.startDate);
        const vacEnd = new Date(vacation.endDate);

        // Check if vacation overlaps with the date range
        return vacStart <= end && vacEnd >= start;
      });
    },
    [vacations]
  );

  // Check for vacation conflicts
  const checkVacationOverlaps = useCallback(
    (startDate, endDate, excludeId = null) => {
      const start = new Date(startDate);
      const end = new Date(endDate);

      return vacations
        .filter((vacation) => (excludeId ? vacation.id !== excludeId : true))
        .filter((vacation) => {
          const vacStart = new Date(vacation.startDate);
          const vacEnd = new Date(vacation.endDate);

          return start <= vacEnd && end >= vacStart;
        });
    },
    [vacations]
  );

  // Setup real-time listener if enabled (rarely needed for vacations)
  useEffect(() => {
    if (enableRealTime) {
      // For vacations, we can set up a simple listener since changes are rare
      const unsubscribe = dataManager.setupVacationListener?.(
        {},
        (updatedVacations, error) => {
          if (error) {
            console.error("Real-time vacation listener error:", error);
            setError(error.message);
            return;
          }

          if (updatedVacations && mountedRef.current) {
            setVacations(updatedVacations);
            setLastUpdated(Date.now());
          }
        }
      );

      if (unsubscribe) {
        listenerRef.current = unsubscribe;

        return () => {
          if (listenerRef.current) {
            listenerRef.current();
            listenerRef.current = null;
          }
        };
      }
    }
  }, [enableRealTime]);

  // Setup auto-refresh if enabled
  useEffect(() => {
    if (autoRefresh && !enableRealTime) {
      const interval = setInterval(() => {
        fetchVacations();
      }, refreshInterval);

      refreshIntervalRef.current = interval;

      return () => {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
          refreshIntervalRef.current = null;
        }
      };
    }
  }, [autoRefresh, enableRealTime, refreshInterval, fetchVacations]);

  // Initial fetch with StrictMode protection
  useEffect(() => {
    if (didInitRef.current) {
      console.log("🏖️ useOptimizedVacations: Already initialized, skipping...");
      return;
    }

    console.log("🏖️ useOptimizedVacations: Initial fetch effect triggered");
    if (!enableRealTime) {
      didInitRef.current = true;
      fetchVacations();
    }

    // Cleanup function for React StrictMode
    return () => {
      // In development with StrictMode, this prevents the effect from running twice
      // The ref persists across unmount/remount cycles
      // console.log("🏖️ useOptimizedVacations: Cleanup effect");
    };
  }, [fetchVacations, enableRealTime]);

  // Cleanup on unmount
  useEffect(() => {
    // Set mounted to true on mount
    mountedRef.current = true;
    console.log(
      "🏖️ useOptimizedVacations: Component mounted, mountedRef set to true"
    );

    return () => {
      console.log(
        "🏖️ useOptimizedVacations: Component unmounting, setting mountedRef to false"
      );
      mountedRef.current = false;

      if (listenerRef.current) {
        listenerRef.current();
      }

      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  return {
    // Data
    vacations,
    loading,
    error,
    lastUpdated,

    // CRUD operations
    fetchVacations,
    createVacation,
    updateVacation,
    deleteVacation,

    // Batch operations
    batchCreateVacations,
    batchDeleteVacations,

    // Utility functions
    getCurrentVacation,
    getUpcomingVacations,
    isDateInVacation,
    getVacationsInRange,
    checkVacationOverlaps,

    // Aliases
    refetch: fetchVacations,
  };
};

// Simplified hook for checking if a date is in vacation (frequently used)
export const useVacationCheck = () => {
  const [vacations, setVacations] = useState([]);
  const [loading, setLoading] = useState(false);

  const mountedRef = useRef(true);
  const didInitRef = useRef(false); // StrictMode protection

  // Fetch vacation data with extended caching
  const fetchVacations = useCallback(async () => {
    if (!mountedRef.current) return;

    setLoading(true);

    try {
      const result = await dataManager.getVacations({ includeExpired: false });

      if (mountedRef.current) {
        setVacations(result);
      }
    } catch (err) {
      console.error("Error fetching vacations for date check:", err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Check if date is in vacation period
  const isDateInVacation = useCallback(
    (date) => {
      if (!date) return false;

      const checkDate = new Date(date);
      return vacations.some((vacation) => {
        const start = new Date(vacation.startDate);
        const end = new Date(vacation.endDate);
        return checkDate >= start && checkDate <= end;
      });
    },
    [vacations]
  );

  // Initial fetch with StrictMode protection
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    fetchVacations();

    // Cleanup function for React StrictMode
    return () => {
      // In development with StrictMode, this prevents the effect from running twice
      // The ref persists across unmount/remount cycles
    };
  }, [fetchVacations]);

  return {
    isDateInVacation,
    vacations,
    loading,
    refetch: fetchVacations,
  };
};
