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
  Timestamp,
} from "firebase/firestore";
import { db, collections, trackDatabaseRead } from "./config";
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

    // REQUIRE dateRange to prevent massive queries
    if (!options.dateRange?.start || !options.dateRange?.end) {
      console.error("🚨 getAppointments() called without required dateRange!");
      console.error(
        "🚨 Use getAppointmentsByDate() for single-day queries or provide explicit dateRange"
      );
      throw new Error(
        "dateRange with start and end dates is required for getAppointments()"
      );
    }

    // Track this operation for monitoring
    trackRead("get_appointments_request", 1);

    // Use the safe range-filtered approach
    return this._executeAppointmentQueryRanged(options);
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

    // Convert string dates to proper Date objects, then to Timestamps
    const start = new Date(startDate);
    const end = new Date(endDate);
    const startTimestamp = Timestamp.fromDate(start);
    const endTimestamp = Timestamp.fromDate(end);

    // Add date range filter using Timestamps
    q = query(
      q,
      where("selectedDate", ">=", startTimestamp),
      where("selectedDate", "<=", endTimestamp),
      orderBy("selectedDate", "asc"),
      orderBy("startTime", "asc")
    );

    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  // Date-range-required query method (prevents massive reads)
  async _executeAppointmentQueryRanged(options = {}) {
    const startTime = Date.now();
    console.log(
      "🔧 _executeAppointmentQueryRanged called with options:",
      options
    );

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
      // REQUIRE date range to prevent massive queries
      if (!options.dateRange?.start || !options.dateRange?.end) {
        console.error(
          "🚨 Range query method called without dateRange – aborting to prevent massive reads"
        );
        throw new Error("dateRange with start and end dates is required");
      }

      // Use efficient server-side date filtering
      let q = query(this.collections.customers);

      // Apply date range filter at database level
      const start = new Date(options.dateRange.start);
      start.setHours(0, 0, 0, 0);
      const end = new Date(options.dateRange.end);
      end.setHours(23, 59, 59, 999);

      // Convert to Timestamps for proper comparison (database stores selectedDate as Timestamp)
      const startTimestamp = Timestamp.fromDate(start);
      const endTimestamp = Timestamp.fromDate(end);

      q = query(
        q,
        where("selectedDate", ">=", startTimestamp),
        where("selectedDate", "<=", endTimestamp),
        orderBy("selectedDate", "asc"),
        orderBy("startTime", "asc")
      );

      console.log("🔧 Using efficient Timestamp date range query:", {
        start: start.toISOString().split("T")[0],
        end: end.toISOString().split("T")[0],
        note: "Using Timestamp comparison (selectedDate is Timestamp in DB)",
      });

      // Apply non-date filters at database level
      if (options.status) {
        console.log("🔧 Applying status filter:", options.status);
        q = query(q, where("status", "==", options.status));
      }

      // Handle limit
      if (options.limit !== null && options.limit !== undefined) {
        console.log("🔧 Applying explicit limit:", options.limit);
        q = query(q, limit(options.limit));
      }

      console.log("🔧 Executing efficient query...");
      const querySnapshot = await getDocs(q);
      console.log("🔧 Query executed, docs found:", querySnapshot.size);

      // Track the actual reads
      trackDatabaseRead(
        `ranged-query-${options.dateRange.start}-to-${options.dateRange.end}`,
        querySnapshot.size
      );

      const appointments = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      console.log("🔧 Processed appointments:", appointments.length);

      // Update metrics
      this.metrics.queriesExecuted++;
      this.metrics.avgQueryTime =
        (this.metrics.avgQueryTime + (Date.now() - startTime)) / 2;

      const result = {
        appointments,
        total: appointments.length,
        lastDoc: querySnapshot.docs[querySnapshot.docs.length - 1] || null,
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

    try {
      // Create proper date range for the specific day
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Convert to Timestamps for proper comparison (database stores selectedDate as Timestamp)
      const startTimestamp = Timestamp.fromDate(startOfDay);
      const endTimestamp = Timestamp.fromDate(endOfDay);

      // EFFICIENT QUERY: Filter at database level using Timestamps
      const q = query(
        this.collections.customers,
        where("selectedDate", ">=", startTimestamp),
        where("selectedDate", "<=", endTimestamp),
        orderBy("selectedDate"),
        orderBy("startTime")
      );

      const querySnapshot = await getDocs(q);
      const appointments = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Track the actual reads for monitoring
      trackDatabaseRead(
        `getAppointmentsByDate(${dateStr})`,
        querySnapshot.size
      );

      console.log(
        `🔧 DataManager: Retrieved ${appointments.length} appointments for ${dateStr} using efficient date query`
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

      // Smart TTL based on date proximity
      const appointmentDateObj = new Date(dateStr);
      const today = new Date();
      const daysDiff = Math.floor((appointmentDateObj - today) / (1000 * 60 * 60 * 24));
      
      let ttl;
      if (daysDiff === 0) {
        ttl = 300000; // Current day: 5 minutes (high activity)
      } else if (daysDiff > 0 && daysDiff <= 7) {
        ttl = 900000; // Current week: 15 minutes
      } else if (daysDiff > 7) {
        ttl = 1800000; // Future: 30 minutes
      } else {
        ttl = 7200000; // Past: 2 hours (rarely accessed)
      }

      // Cache result with smart TTL
      cacheQuery(
        "appointments",
        "byDate",
        { date: dateStr },
        normalizedAppointments,
        {
          ttl: ttl,
          tags: ["appointments", `date:${dateStr}`, `appointments-${dateStr}`],
        }
      );
      
      console.log(`📦 DataManager: Cached appointments for ${dateStr} with TTL: ${ttl/1000}s (${daysDiff >= 0 ? 'future' : 'past'})`);
    

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

        // Update cache with smart TTL for real-time data
        const today = new Date();
        const isCurrentRange = dateRange?.start && new Date(dateRange.start) <= today && new Date(dateRange.end) >= today;
        
        cacheQuery(
          "appointments",
          "list",
          { dateRange },
          { appointments },
          {
            ttl: isCurrentRange ? 300000 : 1800000, // 5min for current, 30min for future
            tags: ["appointments", "realtime-data"],
          }
        );

        // Selective invalidation for date range
        if (dateRange?.start && dateRange?.end) {
          const startDate = new Date(dateRange.start);
          const endDate = new Date(dateRange.end);
          const tagsToInvalidate = [];
          
          // Generate date tags for the range
          for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split("T")[0];
            tagsToInvalidate.push(`date:${dateStr}`, `appointments-${dateStr}`);
          }
          
          if (tagsToInvalidate.length > 0) {
            invalidateTags(tagsToInvalidate);
            console.log(`🔄 Real-time listener invalidated cache for ${tagsToInvalidate.length/2} dates`);
          }
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

      // Cache with very long TTL since vacations change extremely rarely
      cacheQuery("vacations", "list", options, vacations, {
        ttl: 24 * 60 * 60 * 1000, // 24 hours - long TTL for stable data
        tags: ["vacations", "vacation-list"],
      });
      
      console.log(`🏖️ DataManager: Cached ${vacations.length} vacations with 24hr TTL (rarely change)`);
    

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

    // --- ENFORCE VACATION PERIODS ---
    // Fetch all vacation periods (not expired)
    const vacations = await this.getVacations({ includeExpired: false });
    const appointmentDate = createAppointmentDate(appointmentData.selectedDate);
    if (!appointmentDate) {
      throw new Error("Invalid appointment date provided");
    }
    // Check if appointmentDate is in any vacation period
    const isInVacation = vacations.some((vac) => {
      const start = new Date(vac.startDate);
      const end = new Date(vac.endDate);
      // Inclusive range
      return appointmentDate >= start && appointmentDate <= end;
    });
    if (isInVacation) {
      throw new Error(
        "Impossibile prenotare: il centro è chiuso per ferie in questa data."
      );
    }
    // --- END ENFORCE VACATION PERIODS ---

    return await runTransaction(db, async (transaction) => {
      console.log("🔧 Creating appointment with data:", appointmentData);

      // Parse and standardize the appointment date using unified system
      // (already done above)

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

      // Selective cache invalidation after successful transaction
      setTimeout(() => {
        const dateStr = appointmentDate.toISOString().split("T")[0];
        const monthKey = `${appointmentDate.getFullYear()}-${String(appointmentDate.getMonth() + 1).padStart(2, '0')}`;
        
        // Only invalidate cache for the specific date and month
        invalidateTags([`date:${dateStr}`, `appointments-${dateStr}`, `month:${monthKey}`]);
        
        console.log(`🚀 DataManager: Selectively invalidated cache for new appointment on ${dateStr} and month ${monthKey}`);
      }, 0);

      return {
        id: appointmentRef.id,
        ...dataWithTimestamps,
      };
    });
  }

  // Delete appointment with selective cache invalidation
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
        "🗑️ DataManager: Appointment deleted, using selective cache invalidation..."
      );

      // SELECTIVE cache invalidation - only clear what's needed
      if (appointmentDate) {
        try {
          // Parse appointment date safely
          let dateObj;
          if (appointmentDate instanceof Date) {
            dateObj = appointmentDate;
          } else if (appointmentDate?.toDate) {
            dateObj = appointmentDate.toDate();
          } else if (appointmentDate?.seconds) {
            dateObj = new Date(appointmentDate.seconds * 1000);
          } else {
            dateObj = new Date(appointmentDate);
          }

          if (!isNaN(dateObj.getTime())) {
            const dateStr = dateObj.toISOString().split("T")[0];
            
            // Only invalidate cache for specific date
            invalidateTags([`date:${dateStr}`, `appointments-${dateStr}`]);
            
            // Also invalidate month cache if it exists
            const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
            invalidateTags([`month:${monthKey}`]);
            
            console.log(
              "🗑️ DataManager: Selectively invalidated cache for date:",
              dateStr,
              "and month:",
              monthKey
            );
          } else {
            console.warn(
              "🗑️ DataManager: Invalid appointment date, falling back to minimal invalidation:",
              appointmentDate
            );
            // Fallback: only invalidate current day
            const today = new Date().toISOString().split("T")[0];
            invalidateTags([`date:${today}`]);
          }
        } catch (dateError) {
          console.warn(
            "🗑️ DataManager: Error parsing appointment date, minimal cache invalidation:",
            appointmentDate,
            dateError
          );
          // Fallback: only invalidate current day
          const today = new Date().toISOString().split("T")[0];
          invalidateTags([`date:${today}`]);
        }
      } else {
        // No date available, minimal invalidation
        console.log("🗑️ DataManager: No appointment date found, minimal cache invalidation");
        const today = new Date().toISOString().split("T")[0];
        invalidateTags([`date:${today}`]);
      }

      console.log("🗑️ DataManager: Selective cache invalidation completed");

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

    // Get appointments for the specific date only (efficient single-day query)
    const dayAppointments = await this.getAppointmentsByDate(date);
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
