import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  runTransaction,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getCountFromServer,
  getAggregateFromServer,
  count,
} from "firebase/firestore";
import { db, collections } from "./config";
import {
  queryCache,
  cacheQuery,
  getCachedQuery,
  invalidateNamespace,
  invalidateTags,
} from "../cache/queryCache";
import {
  getCachedTotalCount,
  trackRead,
  clearAppointmentCache,
} from "../cache/appointmentCache";

// Centralized Data Manager
class DataManager {
  constructor() {
    this.cache = queryCache; // Use the advanced query cache
    this.activeListeners = new Map();
    this.pendingQueries = new Map();
    this.queryQueue = [];
    this.isProcessingQueue = false;

    // Initialize collection references
    this.collections = {
      customers: collection(db, collections.CUSTOMERS),
      vacations: collection(db, collections.VACATIONS),
      subscribers: collection(db, collections.NEWSLETTER_SUBSCRIBERS),
    };

    // Performance monitoring with read tracking
    this.metrics = {
      queriesExecuted: 0,
      cacheHits: 0,
      listenersActive: 0,
      avgQueryTime: 0,
      readsInLastMinute: [],
    };
  }

  // ==========================================================================
  // APPOINTMENT OPERATIONS WITH SMART CACHING
  // ==========================================================================

  // Get total count of appointments efficiently (without fetching all data)
  async getTotalAppointmentCount(options = {}) {
    console.log("📊 Getting total appointment count efficiently...");

    // Check cache first
    const cachedCount = getCachedTotalCount();
    if (cachedCount !== null) {
      console.log("✅ Returning cached total count:", cachedCount);
      return cachedCount;
    }

    try {
      trackRead("total_count_query", 1);

      let q = this.collections.customers;

      // Apply filters if provided
      if (options.status) {
        q = query(q, where("status", "==", options.status));
      }

      // Get count from server without downloading documents
      const snapshot = await getCountFromServer(q);
      const totalCount = snapshot.data().count;

      console.log("📊 Total appointments in database:", totalCount);

      // Note: We removed the caching of total count since we simplified the cache system

      return totalCount;
    } catch (error) {
      console.error("📊 Error getting appointment count:", error);
      throw error;
    }
  }

  // Get appointments with intelligent caching and deduplication
  async getAppointments(options = {}) {
    console.log("🔧 DataManager.getAppointments called with options:", options);

    // Track this operation for monitoring
    trackRead("get_appointments_request", 1);

    // Use simplified approach without advanced cache
    return this._executeAppointmentQueryLegacy(options);
  }

  // Fetch specific missing months efficiently
  async _fetchMissingMonths(missingMonths) {
    console.log("📡 Fetching missing months:", missingMonths);

    if (missingMonths.length === 0) {
      return [];
    }

    const allMissingAppointments = [];

    // Fetch each missing month separately to minimize query size
    for (const monthKey of missingMonths) {
      try {
        const [year, month] = monthKey.split("-").map(Number);
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

        console.log(`📅 Fetching month ${monthKey}:`, {
          start: monthStart.toISOString().split("T")[0],
          end: monthEnd.toISOString().split("T")[0],
        });

        const monthAppointments = await this._fetchAppointmentsInRange(
          monthStart.toISOString(),
          monthEnd.toISOString()
        );

        allMissingAppointments.push(...monthAppointments);

        // Track reads for this month
        trackRead(
          `fetch_month_${monthKey}`,
          Math.ceil(monthAppointments.length / 100) || 1
        );

        console.log(
          `✅ Fetched ${monthAppointments.length} appointments for ${monthKey}`
        );
      } catch (error) {
        console.error(`❌ Error fetching month ${monthKey}:`, error);
        // Continue with other months even if one fails
      }
    }

    console.log(
      "📡 Total missing appointments fetched:",
      allMissingAppointments.length
    );
    return allMissingAppointments;
  }

  // Efficient range-based fetch for a specific month
  async _fetchAppointmentsInRange(startDate, endDate) {
    let q = query(this.collections.customers);

    // Add date range filter
    q = query(
      q,
      where("selectedDate", ">=", startDate),
      where("selectedDate", "<=", endDate),
      orderBy("selectedDate", "asc"),
      orderBy("startTime", "asc")
    );

    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  // Legacy method for unlimited queries (exports, debugging)
  async _executeAppointmentQueryLegacy(options = {}) {
    const startTime = Date.now();
    console.log("🔧 _executeAppointmentQuery called with options:", options);

    // Track reads for monitoring
    this.metrics.readsInLastMinute.push(startTime);
    // Clean old entries (older than 1 minute)
    this.metrics.readsInLastMinute = this.metrics.readsInLastMinute.filter(
      (time) => startTime - time < 60000
    );

    // Warn if too many reads in short time
    if (this.metrics.readsInLastMinute.length > 10) {
      console.warn(
        `🚨 High read frequency: ${this.metrics.readsInLastMinute.length} reads in last minute`,
        { recentReads: this.metrics.readsInLastMinute }
      );
    }

    try {
      // For mixed date formats, we need to get all appointments and filter client-side
      let q = query(this.collections.customers);
      console.log("🔧 Initial query created");

      // Apply non-date filters at database level
      if (options.status) {
        console.log("🔧 Applying status filter:", options.status);
        q = query(q, where("status", "==", options.status));
      }

      // Add ordering (essential for consistent results)
      console.log("🔧 Adding ordering...");
      q = query(q, orderBy("selectedDate", "asc"), orderBy("startTime", "asc"));

      // Handle limit explicitly - Firestore has a default limit of ~500 docs
      if (options.limit !== null && options.limit !== undefined) {
        console.log("🔧 Applying explicit limit:", options.limit);
        q = query(q, limit(options.limit));
      } else {
        // For unlimited queries, set a reasonable high limit to override Firestore's default
        // 2000 should be more than enough for most use cases while not causing excessive reads
        console.log(
          "🔧 Applying high limit for unlimited query (override default 500)"
        );
        q = query(q, limit(2000)); // Reduced from 10000 to be more conservative
      }

      // Note: No date range filtering at DB level due to mixed formats
      // We'll filter client-side below

      console.log("🔧 Executing query...");
      const querySnapshot = await getDocs(q);
      console.log("🔧 Query executed, docs found:", querySnapshot.size);
      console.log("🔧 Expected total in database: 1614 appointments");

      if (querySnapshot.size !== 1614) {
        console.warn(
          "⚠️ WARNING: Expected 1614 docs but Firestore returned",
          querySnapshot.size
        );
        console.warn("⚠️ This could indicate:");
        console.warn("   - Some appointments have invalid data");
        console.warn("   - Firestore query is not fetching all documents");
        console.warn("   - Database count is incorrect");
      }

      let appointments = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      console.log("🔧 Processed appointments:", appointments.length);

      // Apply date range filter client-side for backward compatibility
      if (options.dateRange?.start && options.dateRange?.end) {
        const start = new Date(options.dateRange.start);
        start.setHours(0, 0, 0, 0);
        const end = new Date(options.dateRange.end);
        end.setHours(23, 59, 59, 999);

        console.log("🔧 DEBUGGING: Date range filtering:", {
          originalRange: options.dateRange,
          startDateFull: start.toISOString(),
          endDateFull: end.toISOString(),
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
        });

        const beforeFilterCount = appointments.length;

        appointments = appointments.filter((appointment) => {
          try {
            let appointmentDate;

            // Handle different date formats for backward compatibility
            if (typeof appointment.selectedDate === "string") {
              if (appointment.selectedDate.includes("T")) {
                // New format: ISO string like '2025-06-25T22:00:00.000Z'
                appointmentDate = new Date(appointment.selectedDate);
              } else {
                // Old format: simple date string like '2025-06-26'
                appointmentDate = new Date(
                  appointment.selectedDate + "T00:00:00.000Z"
                );
              }
            } else if (appointment.selectedDate instanceof Date) {
              appointmentDate = appointment.selectedDate;
            } else if (appointment.selectedDate?.toDate) {
              // Firestore Timestamp
              appointmentDate = appointment.selectedDate.toDate();
            } else {
              console.warn(
                "🔧 DataManager: Unknown date format:",
                appointment.selectedDate
              );
              return false;
            }

            // Check if date is within range
            const isInRange =
              appointmentDate >= start && appointmentDate <= end;

            // Debug the first few appointments to see what's happening
            if (beforeFilterCount <= 5 || !isInRange) {
              console.log("🔧 DEBUGGING: Appointment date filtering:", {
                appointmentId: appointment.id,
                originalDate: appointment.selectedDate,
                parsedDate: appointmentDate.toISOString(),
                parsedDateOnly: appointmentDate.toISOString().split("T")[0],
                rangeStart: start.toISOString().split("T")[0],
                rangeEnd: end.toISOString().split("T")[0],
                isInRange,
                comparison: {
                  afterStart: appointmentDate >= start,
                  beforeEnd: appointmentDate <= end,
                },
              });
            }

            return isInRange;
          } catch (error) {
            console.warn(
              "🔧 DataManager: Error filtering appointment:",
              appointment.id,
              error
            );
            return false;
          }
        });

        console.log(
          "🔧 DEBUGGING: Date filtering results:",
          `${beforeFilterCount} -> ${appointments.length} appointments`
        );
      }

      // Apply limit after filtering
      if (options.limit && appointments.length > options.limit) {
        appointments = appointments.slice(0, options.limit);
        console.log("🔧 Applied client-side limit:", options.limit);
      }

      // Update metrics
      this.metrics.queriesExecuted++;
      this.metrics.avgQueryTime =
        (this.metrics.avgQueryTime + (Date.now() - startTime)) / 2;

      const result = {
        appointments,
        total: appointments.length,
        lastDoc: null, // Not applicable for client-side filtering
      };

      console.log("🔧 Final result:", result);
      return result;
    } catch (error) {
      console.error("🔧 Error executing appointment query:", error);
      throw error;
    }
  }

  // Get appointments for a specific date with optimized caching
  async getAppointmentsByDate(date) {
    const dateStr = new Date(date).toISOString().split("T")[0];

    // Try to get from advanced cache first
    const cachedData = getCachedQuery("appointments", "byDate", {
      date: dateStr,
    });
    if (cachedData) {
      this.metrics.cacheHits++;
      return cachedData;
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      // Get all appointments - we'll filter client-side for backward compatibility
      const q = query(
        this.collections.customers,
        orderBy("selectedDate"),
        orderBy("startTime")
      );

      const querySnapshot = await getDocs(q);
      const allAppointments = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      console.log(
        "🔧 DataManager: All appointments retrieved:",
        allAppointments.length
      );

      // Filter appointments for the specific date (backward compatible)
      const appointments = allAppointments.filter((appointment) => {
        try {
          let appointmentDate;

          // Handle different date formats for backward compatibility
          if (typeof appointment.selectedDate === "string") {
            if (appointment.selectedDate.includes("T")) {
              // New format: ISO string like '2025-06-25T22:00:00.000Z'
              appointmentDate = new Date(appointment.selectedDate);
            } else {
              // Old format: simple date string like '2025-06-26'
              appointmentDate = new Date(
                appointment.selectedDate + "T00:00:00.000Z"
              );
            }
          } else if (appointment.selectedDate instanceof Date) {
            appointmentDate = appointment.selectedDate;
          } else if (appointment.selectedDate?.toDate) {
            // Firestore Timestamp
            appointmentDate = appointment.selectedDate.toDate();
          } else {
            console.warn(
              "🔧 DataManager: Unknown date format:",
              appointment.selectedDate
            );
            return false;
          }

          // Check if the parsed date is valid
          if (isNaN(appointmentDate.getTime())) {
            console.warn(
              "🔧 DataManager: Invalid date value:",
              appointment.selectedDate
            );
            return false;
          }

          // Use timezone-safe date comparison instead of ISO string comparison
          const targetDate = new Date(date);
          const targetYear = targetDate.getFullYear();
          const targetMonth = targetDate.getMonth();
          const targetDay = targetDate.getDate();

          const aptYear = appointmentDate.getFullYear();
          const aptMonth = appointmentDate.getMonth();
          const aptDay = appointmentDate.getDate();

          const matches =
            targetYear === aptYear &&
            targetMonth === aptMonth &&
            targetDay === aptDay;

          if (matches) {
            console.log("🔧 DataManager: Matched appointment:", {
              id: appointment.id,
              name: appointment.name,
              startTime: appointment.startTime,
              endTime: appointment.endTime,
              originalDate: appointment.selectedDate,
              parsedDate: appointmentDate.toISOString(),
              targetDate: targetDate.toISOString(),
            });
          }

          return matches;
        } catch (error) {
          console.error(
            "🔧 DataManager: Error filtering appointment:",
            appointment.id,
            error
          );
          return false;
        }
      });

      console.log(
        "🔧 DataManager: Filtered appointments for",
        dateStr,
        ":",
        appointments.length
      );

      // Normalize the date format for consistency
      const normalizedAppointments = appointments.map((appointment) => {
        let normalizedDate;

        try {
          if (typeof appointment.selectedDate === "string") {
            if (appointment.selectedDate.includes("T")) {
              // New format: ISO string
              normalizedDate = new Date(appointment.selectedDate);
            } else {
              // Old format: simple date string
              normalizedDate = new Date(
                appointment.selectedDate + "T00:00:00.000Z"
              );
            }
          } else if (appointment.selectedDate instanceof Date) {
            normalizedDate = appointment.selectedDate;
          } else if (appointment.selectedDate?.toDate) {
            normalizedDate = appointment.selectedDate.toDate();
          } else {
            normalizedDate = new Date(appointment.selectedDate);
          }
        } catch (error) {
          console.error("🔧 DataManager: Error normalizing date:", error);
          normalizedDate = new Date();
        }

        return {
          ...appointment,
          selectedDate: normalizedDate,
          createdAt:
            appointment.createdAt?.toDate?.() ||
            new Date(appointment.createdAt || Date.now()),
        };
      });

      // Cache result with advanced cache
      cacheQuery(
        "appointments",
        "byDate",
        { date: dateStr },
        normalizedAppointments,
        {
          ttl: 300000, // 5min TTL
          tags: ["appointments", `date:${dateStr}`],
        }
      );

      this.metrics.queriesExecuted++;
      return normalizedAppointments;
    } catch (error) {
      console.error("Error fetching appointments by date:", error);
      throw error;
    }
  }

  // ==========================================================================
  // REAL-TIME LISTENERS WITH INTELLIGENT MANAGEMENT
  // ==========================================================================

  // Setup real-time listener for appointments
  setupAppointmentListener(dateRange, callback, options = {}) {
    const listenerKey = this.cache.generateKey("appointment_listener", {
      dateRange,
      ...options,
    });

    // If listener already exists, return existing unsubscribe function
    if (this.activeListeners.has(listenerKey)) {
      const existingListener = this.activeListeners.get(listenerKey);
      return existingListener.unsubscribe;
    }

    let q = query(this.collections.customers);

    // Apply date range filter
    if (dateRange?.start && dateRange?.end) {
      const start = new Date(dateRange.start);
      start.setHours(0, 0, 0, 0);
      const end = new Date(dateRange.end);
      end.setHours(23, 59, 59, 999);

      q = query(
        q,
        where("selectedDate", ">=", start.toISOString()),
        where("selectedDate", "<=", end.toISOString()),
        orderBy("selectedDate"),
        orderBy("startTime")
      );
    }

    // Create listener
    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const appointments = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Update cache immediately with advanced cache system
        cacheQuery(
          "appointments",
          "list",
          { dateRange },
          { appointments },
          {
            ttl: 300000, // 5min TTL
            tags: ["appointments"],
          }
        );

        // Invalidate related cache entries
        if (dateRange?.start) {
          const startDate = dateRange.start.toISOString().split("T")[0];
          const endDate = dateRange.end.toISOString().split("T")[0];
          invalidateTags("appointments", `date:${startDate}:${endDate}`);
        }

        // Call the callback
        callback(appointments);
      },
      (error) => {
        console.error("Appointment listener error:", error);
        callback(null, error);
      }
    );

    // Store listener reference
    this.activeListeners.set(listenerKey, {
      unsubscribe,
      createdAt: Date.now(),
      options,
    });

    this.metrics.listenersActive++;

    return unsubscribe;
  }

  // ==========================================================================
  // VACATION OPERATIONS WITH LONG-TERM CACHING
  // ==========================================================================

  // Get vacation periods with extended caching
  async getVacations(options = {}) {
    console.log("🏖️ DataManager: getVacations called with options:", options);

    // Try to get from advanced cache first
    const cachedData = getCachedQuery("vacations", "list", options);
    if (cachedData) {
      console.log(
        "✅ DataManager: Returning cached vacation data:",
        cachedData.length,
        "items"
      );
      this.metrics.cacheHits++;
      return cachedData;
    }

    console.log("📡 DataManager: No cache hit, fetching from database...");

    try {
      let q = query(this.collections.vacations);

      // Simplify query to avoid composite index requirement
      if (!options.includeExpired) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        console.log(
          "🗓️ DataManager: Filtering vacations after:",
          today.toISOString()
        );
        // Only filter by endDate to avoid composite index
        q = query(q, where("endDate", ">=", today.toISOString()));
      }

      // Simple ordering by startDate only
      q = query(q, orderBy("startDate", "asc"));

      console.log("🔍 DataManager: Executing vacation query...");
      const querySnapshot = await getDocs(q);
      console.log(
        "📄 DataManager: Query returned",
        querySnapshot.docs.length,
        "documents"
      );

      const vacations = querySnapshot.docs.map((doc) => {
        const data = doc.data();
        console.log(
          "🏖️ DataManager: Processing vacation document:",
          doc.id,
          data
        );
        return {
          id: doc.id,
          ...data,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
        };
      });

      console.log(
        "💾 DataManager: Caching vacation data:",
        vacations.length,
        "items"
      );

      // Cache with long TTL (7 days) since vacations change very rarely
      cacheQuery("vacations", "list", options, vacations, {
        ttl: 7 * 24 * 60 * 60 * 1000, // 7 days (extended from 24 hours)
        tags: ["vacations"],
      });

      this.metrics.queriesExecuted++;
      console.log(
        "✅ DataManager: Returning fresh vacation data:",
        vacations.length,
        "items"
      );
      return vacations;
    } catch (error) {
      console.error("❌ DataManager: Error fetching vacations:", error);
      throw error;
    }
  }

  // ==========================================================================
  // BATCH OPERATIONS FOR EFFICIENCY
  // ==========================================================================

  // Batch create appointments
  async batchCreateAppointments(appointmentsData) {
    const batch = writeBatch(db);
    const results = [];

    appointmentsData.forEach((appointmentData) => {
      const appointmentRef = doc(this.collections.customers);
      const dataWithTimestamps = {
        ...appointmentData,
        // Ensure selectedDate is stored as ISO string for consistent querying
        selectedDate:
          appointmentData.selectedDate instanceof Date
            ? appointmentData.selectedDate.toISOString()
            : new Date(appointmentData.selectedDate).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      batch.set(appointmentRef, dataWithTimestamps);
      results.push({
        id: appointmentRef.id,
        ...dataWithTimestamps,
      });
    });

    await batch.commit();

    // Invalidate relevant cache
    invalidateTags("appointments");

    return results;
  }

  // Batch update appointment statuses
  async batchUpdateAppointmentStatus(appointmentIds, status, notes = "") {
    const batch = writeBatch(db);

    appointmentIds.forEach((id) => {
      const appointmentRef = doc(this.collections.customers, id);
      batch.update(appointmentRef, {
        status,
        statusNotes: notes,
        statusUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    await batch.commit();

    // Invalidate cache
    invalidateTags("appointments");

    return true;
  }

  // ==========================================================================
  // CONFLICT CHECKING WITH TRANSACTIONS
  // ==========================================================================

  // Create appointment with conflict checking
  async createAppointmentSafe(appointmentData) {
    // Import unified date utilities
    const { createAppointmentDate, formatDateString, parseDate } = await import(
      "@/lib/utils/dateUtils"
    );

    return await runTransaction(db, async (transaction) => {
      console.log("🔧 Creating appointment with data:", appointmentData);

      // Parse and standardize the appointment date using unified system
      const appointmentDate = createAppointmentDate(
        appointmentData.selectedDate
      );
      if (!appointmentDate) {
        throw new Error("Invalid appointment date provided");
      }

      console.log("🔧 Standardized appointment date:", {
        original: appointmentData.selectedDate,
        standardized: appointmentDate,
        formatted: formatDateString(appointmentDate),
      });

      // Check for conflicts within transaction using standardized date
      const conflicts = await this.checkTimeConflicts(
        appointmentDate,
        appointmentData.startTime,
        appointmentData.endTime
      );

      console.log("🔧 Conflict check result:", {
        conflictsFound: conflicts.length,
        conflicts: conflicts.map((c) => ({
          id: c.id,
          name: c.name,
          time: `${c.startTime}-${c.endTime}`,
        })),
      });

      if (conflicts.length > 0) {
        throw new Error("Time slot conflicts with existing appointment");
      }

      const appointmentRef = doc(this.collections.customers);
      const dataWithTimestamps = {
        ...appointmentData,
        // Store the standardized local date as Date object
        selectedDate: appointmentDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      console.log("🔧 Final appointment data for storage:", dataWithTimestamps);

      transaction.set(appointmentRef, dataWithTimestamps);

      // Invalidate cache after successful transaction
      setTimeout(() => {
        invalidateTags("appointments");
      }, 0);

      return {
        id: appointmentRef.id,
        ...dataWithTimestamps,
      };
    });
  }

  // Delete appointment with cache invalidation
  async deleteAppointment(appointmentId) {
    try {
      console.log("🗑️ DataManager: Deleting appointment:", appointmentId);

      // First, get the appointment to know which date to invalidate
      const appointmentRef = doc(this.collections.customers, appointmentId);
      const appointmentDoc = await getDoc(appointmentRef);

      let appointmentDate = null;
      if (appointmentDoc.exists()) {
        const data = appointmentDoc.data();
        appointmentDate = data.selectedDate;
        console.log(
          "🗑️ DataManager: Appointment date to invalidate:",
          appointmentDate
        );
      }

      // Delete the appointment
      await deleteDoc(appointmentRef);

      console.log(
        "🗑️ DataManager: Appointment deleted, invalidating caches..."
      );

      // Comprehensive cache invalidation
      invalidateTags("appointments");

      // Invalidate specific date cache if we have the date
      if (appointmentDate) {
        try {
          // Safely create date object and validate it
          const dateObj = new Date(appointmentDate);
          if (!isNaN(dateObj.getTime())) {
            const dateStr = dateObj.toISOString().split("T")[0];
            invalidateTags(`date:${dateStr}`);
            console.log(
              "🗑️ DataManager: Invalidated date-specific cache:",
              dateStr
            );
          } else {
            console.warn(
              "🗑️ DataManager: Invalid appointment date, skipping date cache invalidation:",
              appointmentDate
            );
          }
        } catch (dateError) {
          console.warn(
            "🗑️ DataManager: Error parsing appointment date, skipping date cache invalidation:",
            appointmentDate,
            dateError
          );
        }
      }

      // Also clear appointment cache specifically
      const { clearAppointmentCache } = await import(
        "@/lib/cache/appointmentCache"
      );
      clearAppointmentCache();

      // Clear the query cache entirely to be safe
      const { clearCache } = await import("@/lib/cache/queryCache");
      clearCache();

      console.log("🗑️ DataManager: All caches cleared successfully");

      return true;
    } catch (error) {
      console.error("🗑️ DataManager: Error deleting appointment:", error);
      throw error;
    }
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  // Check time conflicts efficiently
  async checkTimeConflicts(date, startTime, endTime, excludeId = null) {
    // Import unified date utilities
    const { formatDateString, appointmentDateMatches } = await import(
      "@/lib/utils/dateUtils"
    );

    console.log("🔍 Checking conflicts for:", {
      date: date,
      dateFormatted: formatDateString(date),
      timeSlot: `${startTime}-${endTime}`,
      excludeId,
    });

    // Get all appointments (since we need to filter by date properly)
    const allAppointments = await this.getAppointments();
    console.log(
      "🔍 Total appointments to check:",
      allAppointments.appointments?.length || 0
    );

    // Filter for the specific date using unified date comparison
    const dayAppointments = allAppointments.appointments.filter(
      (appointment) => {
        const matches = appointmentDateMatches(appointment.selectedDate, date);
        if (matches) {
          console.log("🔍 Found appointment on target date:", {
            id: appointment.id,
            name: appointment.name,
            time: `${appointment.startTime}-${appointment.endTime}`,
            rawDate: appointment.selectedDate,
          });
        }
        return matches;
      }
    );

    console.log("🔍 Appointments on target date:", dayAppointments.length);

    // Check for time conflicts
    const conflicts = dayAppointments
      .filter((apt) => (excludeId ? apt.id !== excludeId : true))
      .filter((apt) => {
        const aptStart = this.timeToMinutes(apt.startTime);
        const aptEnd = this.timeToMinutes(apt.endTime);
        const newStart = this.timeToMinutes(startTime);
        const newEnd = this.timeToMinutes(endTime);

        const hasConflict = newStart < aptEnd && newEnd > aptStart;

        if (hasConflict) {
          console.log("🔍 CONFLICT DETECTED:", {
            existingAppointment: {
              id: apt.id,
              name: apt.name,
              time: `${apt.startTime}-${apt.endTime}`,
              minutes: `${aptStart}-${aptEnd}`,
            },
            newAppointment: {
              time: `${startTime}-${endTime}`,
              minutes: `${newStart}-${newEnd}`,
            },
          });
        }

        return hasConflict;
      });

    console.log("🔍 Final conflicts found:", conflicts.length);
    return conflicts;
  }

  // Helper: Convert time to minutes
  timeToMinutes(timeString) {
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours * 60 + minutes;
  }

  // Cleanup old listeners
  cleanupListeners(maxAge = 3600000) {
    // 1 hour
    const now = Date.now();

    for (const [key, listener] of this.activeListeners) {
      if (now - listener.createdAt > maxAge) {
        listener.unsubscribe();
        this.activeListeners.delete(key);
        this.metrics.listenersActive--;
      }
    }
  }

  // Get performance metrics
  getMetrics() {
    return {
      ...this.metrics,
      cache: this.cache.getStats(),
      activeListeners: this.activeListeners.size,
    };
  }

  // Cleanup method for component unmount
  cleanup() {
    // Unsubscribe all listeners
    for (const [key, listener] of this.activeListeners) {
      listener.unsubscribe();
    }

    this.activeListeners.clear();
    this.cache.clear();
    this.pendingQueries.clear();
    this.metrics.listenersActive = 0;
  }
}

// Create singleton instance
export const dataManager = new DataManager();

// Export for testing and advanced usage
export { DataManager };

// Export convenience methods
export const {
  getAppointments,
  getAppointmentsByDate,
  getTotalAppointmentCount,
  getVacations,
  createAppointmentSafe,
  batchCreateAppointments,
  batchUpdateAppointmentStatus,
  setupAppointmentListener,
  checkTimeConflicts,
  getMetrics,
  cleanup,
  deleteAppointment,
} = dataManager;
