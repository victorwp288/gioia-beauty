// Appointment-specific caching layer for Gioia Beauty
import { API_CONFIG } from "../utils/constants";

// Cache configuration for appointments
const CACHE_CONFIG = {
  TTL: {
    APPOINTMENTS_LIST: API_CONFIG.CACHE_TTL.MEDIUM, // 30 minutes
    APPOINTMENT_DETAIL: API_CONFIG.CACHE_TTL.LONG, // 24 hours
    TIME_SLOTS: API_CONFIG.CACHE_TTL.SHORT, // 5 minutes
    STATS: API_CONFIG.CACHE_TTL.MEDIUM, // 30 minutes
    DATE_SPECIFIC: API_CONFIG.CACHE_TTL.SHORT, // 5 minutes (for current day queries)
  },
  MAX_SIZE: 1000, // Maximum number of cache entries
};

// In-memory cache store
class AppointmentCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
    };

    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  // Generate cache key from parameters
  generateKey(type, params = {}) {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((result, key) => {
        result[key] = params[key];
        return result;
      }, {});

    return `${type}:${JSON.stringify(sortedParams)}`;
  }

  // Set cache entry with TTL
  set(key, data, ttl = CACHE_CONFIG.TTL.APPOINTMENTS_LIST) {
    // Enforce max cache size by removing oldest entries
    if (this.cache.size >= CACHE_CONFIG.MAX_SIZE) {
      this.evictOldest();
    }

    const expiresAt = Date.now() + ttl;
    const entry = {
      data,
      expiresAt,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };

    this.cache.set(key, entry);
    this.stats.sets++;

    // Set cleanup timer
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    const timer = setTimeout(() => {
      this.delete(key);
    }, ttl);

    this.timers.set(key, timer);

    return true;
  }

  // Get cache entry
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this.stats.hits++;

    return entry.data;
  }

  // Delete cache entry
  delete(key) {
    const existed = this.cache.delete(key);

    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }

    if (existed) {
      this.stats.deletes++;
    }

    return existed;
  }

  // Check if key exists and is not expired
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  // Clear all cache entries
  clear() {
    this.cache.clear();
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.resetStats();
  }

  // Evict oldest entry
  evictOldest() {
    let oldestKey = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  // Clean up expired entries
  cleanup() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach((key) => this.delete(key));
  }

  // Get cache statistics
  getStats() {
    const hitRate =
      this.stats.hits / (this.stats.hits + this.stats.misses) || 0;

    return {
      ...this.stats,
      hitRate: (hitRate * 100).toFixed(2) + "%",
      size: this.cache.size,
      maxSize: CACHE_CONFIG.MAX_SIZE,
      memoryUsage: this.getMemoryUsage(),
    };
  }

  // Reset statistics
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
    };
  }

  // Estimate memory usage
  getMemoryUsage() {
    let size = 0;
    for (const [key, entry] of this.cache.entries()) {
      size += key.length * 2; // Approximate string size
      size += JSON.stringify(entry.data).length * 2;
      size += 64; // Approximate overhead
    }
    return `${(size / 1024).toFixed(2)} KB`;
  }

  // Destroy cache and cleanup
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }

  // Clean up past appointment data periodically (call this from app initialization)
  cleanupPastData() {
    // Implementation of cleanupPastData method
    const today = new Date();
    const currentDateKey = today.toISOString().split("T")[0];

    let cleanedCount = 0;

    // Clean up any cached entries that are for dates in the past
    for (const [key, entry] of this.cache.entries()) {
      try {
        // Check if this is a date-specific entry
        if (key.includes("appointments_by_date")) {
          const match = key.match(/"date":"([^"]+)"/);
          if (match) {
            const entryDate = match[1];
            if (entryDate < currentDateKey) {
              this.delete(key);
              cleanedCount++;
            }
          }
        }
      } catch (error) {
        console.warn("Error cleaning cache entry:", key, error);
      }
    }

    console.log(
      `🧹 Cache: Cleaned up ${cleanedCount} past appointment entries`
    );
    return cleanedCount;
  }
}

// Create singleton instance
const appointmentCache = new AppointmentCache();

// ============================================================================
// HIGH-LEVEL CACHING FUNCTIONS
// ============================================================================

// Cache appointments list with filtering parameters
export const cacheAppointmentsList = (params, data) => {
  const key = appointmentCache.generateKey("appointments_list", params);
  return appointmentCache.set(key, data, CACHE_CONFIG.TTL.APPOINTMENTS_LIST);
};

// Get cached appointments list
export const getCachedAppointmentsList = (params) => {
  const key = appointmentCache.generateKey("appointments_list", params);
  return appointmentCache.get(key);
};

// Cache single appointment
export const cacheAppointment = (id, data) => {
  const key = appointmentCache.generateKey("appointment", { id });
  return appointmentCache.set(key, data, CACHE_CONFIG.TTL.APPOINTMENT_DETAIL);
};

// Get cached appointment
export const getCachedAppointment = (id) => {
  const key = appointmentCache.generateKey("appointment", { id });
  return appointmentCache.get(key);
};

// Cache appointments by date
export const cacheAppointmentsByDate = (date, data) => {
  const key = appointmentCache.generateKey("appointments_by_date", { date });
  return appointmentCache.set(key, data, CACHE_CONFIG.TTL.DATE_SPECIFIC);
};

// Get cached appointments by date
export const getCachedAppointmentsByDate = (date) => {
  const key = appointmentCache.generateKey("appointments_by_date", { date });
  return appointmentCache.get(key);
};

// Cache time slots for a specific date
export const cacheTimeSlots = (date, appointmentType, duration, data) => {
  const key = appointmentCache.generateKey("time_slots", {
    date,
    appointmentType,
    duration,
  });
  return appointmentCache.set(key, data, CACHE_CONFIG.TTL.TIME_SLOTS);
};

// Get cached time slots
export const getCachedTimeSlots = (date, appointmentType, duration) => {
  const key = appointmentCache.generateKey("time_slots", {
    date,
    appointmentType,
    duration,
  });
  return appointmentCache.get(key);
};

// Cache appointment statistics
export const cacheAppointmentStats = (dateRange, data) => {
  const key = appointmentCache.generateKey("appointment_stats", dateRange);
  return appointmentCache.set(key, data, CACHE_CONFIG.TTL.STATS);
};

// Get cached appointment statistics
export const getCachedAppointmentStats = (dateRange) => {
  const key = appointmentCache.generateKey("appointment_stats", dateRange);
  return appointmentCache.get(key);
};

// ============================================================================
// CACHE INVALIDATION STRATEGIES
// ============================================================================

// Invalidate appointment-related cache when appointment is created/updated/deleted
export const invalidateAppointmentCache = (appointmentId, appointmentDate) => {
  const patterns = [
    "appointments_list",
    "appointment_stats",
    `appointments_by_date:{"date":"${appointmentDate}"}`,
    `appointment:{"id":"${appointmentId}"}`,
  ];

  let invalidatedCount = 0;

  // Invalidate specific patterns
  for (const [key] of appointmentCache.cache.entries()) {
    for (const pattern of patterns) {
      if (key.includes(pattern)) {
        appointmentCache.delete(key);
        invalidatedCount++;
      }
    }
  }

  // Invalidate time slots for the affected date
  const dateStr = new Date(appointmentDate).toISOString().split("T")[0];
  for (const [key] of appointmentCache.cache.entries()) {
    if (key.includes("time_slots") && key.includes(`"date":"${dateStr}"`)) {
      appointmentCache.delete(key);
      invalidatedCount++;
    }
  }

  return invalidatedCount;
};

// Invalidate all appointment lists (when significant changes occur)
export const invalidateAppointmentLists = () => {
  let invalidatedCount = 0;

  for (const [key] of appointmentCache.cache.entries()) {
    if (
      key.includes("appointments_list") ||
      key.includes("appointment_stats")
    ) {
      appointmentCache.delete(key);
      invalidatedCount++;
    }
  }

  return invalidatedCount;
};

// Invalidate time slots for a specific date
export const invalidateTimeSlots = (date) => {
  const dateStr = new Date(date).toISOString().split("T")[0];
  let invalidatedCount = 0;

  for (const [key] of appointmentCache.cache.entries()) {
    if (key.includes("time_slots") && key.includes(`"date":"${dateStr}"`)) {
      appointmentCache.delete(key);
      invalidatedCount++;
    }
  }

  return invalidatedCount;
};

// Invalidate cache by pattern
export const invalidateByPattern = (pattern) => {
  let invalidatedCount = 0;

  for (const [key] of appointmentCache.cache.entries()) {
    if (key.includes(pattern)) {
      appointmentCache.delete(key);
      invalidatedCount++;
    }
  }

  return invalidatedCount;
};

// ============================================================================
// CACHE WARMING STRATEGIES
// ============================================================================

// Warm cache with frequently accessed data
export const warmAppointmentCache = async (appointmentService) => {
  try {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    // Warm today's appointments
    const todayAppointments = await appointmentService.getAppointmentsByDate(
      today
    );
    cacheAppointmentsByDate(today.toISOString(), todayAppointments);

    // Warm tomorrow's appointments
    const tomorrowAppointments = await appointmentService.getAppointmentsByDate(
      tomorrow
    );
    cacheAppointmentsByDate(tomorrow.toISOString(), tomorrowAppointments);

    // Warm recent appointments list
    const recentAppointments = await appointmentService.getAppointments({
      dateRange: {
        start: today,
        end: nextWeek,
      },
      limit: 50,
    });
    cacheAppointmentsList(
      {
        dateRange: {
          start: today.toISOString(),
          end: nextWeek.toISOString(),
        },
        limit: 50,
      },
      recentAppointments
    );

    // Warm individual appointments
    if (recentAppointments.appointments) {
      recentAppointments.appointments.forEach((appointment) => {
        cacheAppointment(appointment.id, appointment);
      });
    }

    return true;
  } catch (error) {
    console.error("Error warming appointment cache:", error);
    return false;
  }
};

// ============================================================================
// CACHE UTILITIES
// ============================================================================

// Get cache statistics
export const getAppointmentCacheStats = () => {
  return appointmentCache.getStats();
};

// Clear all appointment cache
export const clearAppointmentCache = () => {
  return appointmentCache.clear();
};

// Check if appointment cache is healthy
export const isAppointmentCacheHealthy = () => {
  const stats = appointmentCache.getStats();
  const hitRate = parseFloat(stats.hitRate);

  return {
    healthy: hitRate > 50 && stats.size < CACHE_CONFIG.MAX_SIZE * 0.9,
    hitRate,
    size: stats.size,
    maxSize: CACHE_CONFIG.MAX_SIZE,
    recommendations: hitRate < 50 ? ["Consider increasing TTL values"] : [],
  };
};

// Manual cache entry management
export const setAppointmentCacheEntry = (type, params, data, ttl) => {
  const key = appointmentCache.generateKey(type, params);
  return appointmentCache.set(key, data, ttl);
};

export const getAppointmentCacheEntry = (type, params) => {
  const key = appointmentCache.generateKey(type, params);
  return appointmentCache.get(key);
};

export const deleteAppointmentCacheEntry = (type, params) => {
  const key = appointmentCache.generateKey(type, params);
  return appointmentCache.delete(key);
};

// Export the cache instance for advanced usage
export { appointmentCache };

// Add missing functions that dataManager expects
export const trackRead = (operation, count) => {
  // Simple tracking - just log for now
  console.log(
    `📊 Cache: Tracked read operation: ${operation}, count: ${count}`
  );
};

export const getCachedTotalCount = () => {
  // For now, return null to indicate no cached count
  // This could be enhanced later if needed
  return null;
};

// Clean up past appointment data periodically (call this from app initialization)
export const cleanupPastAppointmentData = () => {
  return appointmentCache.cleanupPastData();
};

// Cleanup on process termination
if (typeof process !== "undefined") {
  process.on("exit", () => {
    appointmentCache.destroy();
  });

  process.on("SIGINT", () => {
    appointmentCache.destroy();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    appointmentCache.destroy();
    process.exit(0);
  });
}
