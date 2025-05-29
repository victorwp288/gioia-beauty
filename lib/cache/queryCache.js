// General-purpose query caching system for Gioia Beauty
import { API_CONFIG, FEATURE_FLAGS } from "../utils/constants";

// Query cache configuration
const QUERY_CACHE_CONFIG = {
  TTL: {
    DEFAULT: API_CONFIG.CACHE_TTL.MEDIUM, // 30 minutes
    SHORT: API_CONFIG.CACHE_TTL.SHORT, // 5 minutes
    LONG: API_CONFIG.CACHE_TTL.LONG, // 24 hours
  },
  MAX_SIZE: 2000, // Maximum number of cache entries
  MAX_MEMORY_MB: 50, // Maximum memory usage in MB
  CLEANUP_INTERVAL: 10 * 60 * 1000, // 10 minutes
};

// Query cache class
class QueryCache {
  constructor() {
    this.cache = new Map();
    this.accessOrder = new Set(); // For LRU eviction
    this.timers = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      memoryPressureEvictions: 0,
    };

    // Only enable caching if feature flag is enabled
    this.enabled = FEATURE_FLAGS.ENABLE_CACHING;

    // Start cleanup interval
    if (this.enabled) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, QUERY_CACHE_CONFIG.CLEANUP_INTERVAL);
    }
  }

  // Generate standardized cache key
  generateKey(namespace, operation, params = {}) {
    const sortedParams = this._sortParams(params);
    return `${namespace}:${operation}:${JSON.stringify(sortedParams)}`;
  }

  // Sort parameters for consistent key generation
  _sortParams(params) {
    if (typeof params !== "object" || params === null) {
      return params;
    }

    if (Array.isArray(params)) {
      return params.map((item) => this._sortParams(item));
    }

    const sorted = {};
    Object.keys(params)
      .sort()
      .forEach((key) => {
        sorted[key] = this._sortParams(params[key]);
      });

    return sorted;
  }

  // Set cache entry with TTL and tags
  set(key, data, options = {}) {
    if (!this.enabled) return false;

    const {
      ttl = QUERY_CACHE_CONFIG.TTL.DEFAULT,
      tags = [],
      metadata = {},
    } = options;

    // Check memory pressure and evict if necessary
    this._handleMemoryPressure();

    // Enforce max cache size
    if (this.cache.size >= QUERY_CACHE_CONFIG.MAX_SIZE) {
      this._evictLRU();
    }

    const now = Date.now();
    const expiresAt = now + ttl;

    const entry = {
      data,
      expiresAt,
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
      ttl,
      tags: new Set(tags),
      metadata,
      size: this._estimateSize(data),
    };

    // Remove from access order if it exists, then add to end
    this.accessOrder.delete(key);
    this.accessOrder.add(key);

    this.cache.set(key, entry);
    this.stats.sets++;

    // Set expiration timer
    this._setExpirationTimer(key, ttl);

    return true;
  }

  // Get cache entry
  get(key) {
    if (!this.enabled) return null;

    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    // Update access information
    entry.lastAccessed = Date.now();
    entry.accessCount++;
    this.stats.hits++;

    // Update LRU order
    this.accessOrder.delete(key);
    this.accessOrder.add(key);

    return entry.data;
  }

  // Get cache entry with metadata
  getWithMetadata(key) {
    if (!this.enabled) return null;

    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    // Update access information
    entry.lastAccessed = Date.now();
    entry.accessCount++;
    this.stats.hits++;

    // Update LRU order
    this.accessOrder.delete(key);
    this.accessOrder.add(key);

    return {
      data: entry.data,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
      lastAccessed: entry.lastAccessed,
      accessCount: entry.accessCount,
      ttl: entry.ttl,
      expiresAt: entry.expiresAt,
    };
  }

  // Check if key exists and is not expired
  has(key) {
    if (!this.enabled) return false;

    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  // Delete cache entry
  delete(key) {
    if (!this.enabled) return false;

    const existed = this.cache.delete(key);
    this.accessOrder.delete(key);

    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }

    if (existed) {
      this.stats.deletes++;
    }

    return existed;
  }

  // Clear all cache entries
  clear() {
    this.cache.clear();
    this.accessOrder.clear();
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.resetStats();
  }

  // Invalidate entries by tag
  invalidateByTag(tag) {
    if (!this.enabled) return 0;

    let invalidatedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.tags.has(tag)) {
        this.delete(key);
        invalidatedCount++;
      }
    }

    return invalidatedCount;
  }

  // Invalidate entries by pattern matching
  invalidateByPattern(pattern) {
    if (!this.enabled) return 0;

    let invalidatedCount = 0;
    const regex = new RegExp(pattern);

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.delete(key);
        invalidatedCount++;
      }
    }

    return invalidatedCount;
  }

  // Invalidate entries by namespace
  invalidateByNamespace(namespace) {
    return this.invalidateByPattern(`^${namespace}:`);
  }

  // Update TTL for existing entry
  updateTTL(key, newTTL) {
    if (!this.enabled) return false;

    const entry = this.cache.get(key);
    if (!entry) return false;

    const now = Date.now();
    entry.expiresAt = now + newTTL;
    entry.ttl = newTTL;

    // Update expiration timer
    this._setExpirationTimer(key, newTTL);

    return true;
  }

  // Get cache statistics
  getStats() {
    const hitRate =
      this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
    const memoryUsage = this._calculateMemoryUsage();

    return {
      ...this.stats,
      enabled: this.enabled,
      hitRate: (hitRate * 100).toFixed(2) + "%",
      size: this.cache.size,
      maxSize: QUERY_CACHE_CONFIG.MAX_SIZE,
      memoryUsage: memoryUsage.formatted,
      memoryUsageBytes: memoryUsage.bytes,
      maxMemoryMB: QUERY_CACHE_CONFIG.MAX_MEMORY_MB,
      oldestEntry: this._getOldestEntry(),
      newestEntry: this._getNewestEntry(),
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
      memoryPressureEvictions: 0,
    };
  }

  // Get all cache keys
  keys() {
    return Array.from(this.cache.keys());
  }

  // Get cache entry count by namespace
  getNamespaceStats() {
    const namespaces = {};

    for (const key of this.cache.keys()) {
      const namespace = key.split(":")[0];
      namespaces[namespace] = (namespaces[namespace] || 0) + 1;
    }

    return namespaces;
  }

  // Cleanup expired entries
  cleanup() {
    if (!this.enabled) return;

    const now = Date.now();
    const expiredKeys = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach((key) => this.delete(key));
  }

  // Handle memory pressure by evicting entries
  _handleMemoryPressure() {
    const memoryUsage = this._calculateMemoryUsage();
    const maxMemoryBytes = QUERY_CACHE_CONFIG.MAX_MEMORY_MB * 1024 * 1024;

    while (memoryUsage.bytes > maxMemoryBytes && this.cache.size > 0) {
      this._evictLRU();
      this.stats.memoryPressureEvictions++;
    }
  }

  // Evict least recently used entry
  _evictLRU() {
    if (this.accessOrder.size === 0) return;

    const oldestKey = this.accessOrder.values().next().value;
    if (oldestKey) {
      this.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  // Set expiration timer for cache entry
  _setExpirationTimer(key, ttl) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    const timer = setTimeout(() => {
      this.delete(key);
    }, ttl);

    this.timers.set(key, timer);
  }

  // Estimate size of data in bytes
  _estimateSize(data) {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      // Fallback estimation
      return JSON.stringify(data).length * 2;
    }
  }

  // Calculate total memory usage
  _calculateMemoryUsage() {
    let totalBytes = 0;

    for (const [key, entry] of this.cache.entries()) {
      totalBytes += key.length * 2; // Key size
      totalBytes += entry.size; // Data size
      totalBytes += 200; // Estimated overhead for entry metadata
    }

    return {
      bytes: totalBytes,
      formatted: this._formatBytes(totalBytes),
    };
  }

  // Format bytes to human readable format
  _formatBytes(bytes) {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // Get oldest cache entry info
  _getOldestEntry() {
    let oldest = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldest = { key, createdAt: entry.createdAt };
      }
    }

    return oldest;
  }

  // Get newest cache entry info
  _getNewestEntry() {
    let newest = null;
    let newestTime = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt > newestTime) {
        newestTime = entry.createdAt;
        newest = { key, createdAt: entry.createdAt };
      }
    }

    return newest;
  }

  // Destroy cache and cleanup
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

// Create singleton instance
const queryCache = new QueryCache();

// ============================================================================
// HIGH-LEVEL CACHING FUNCTIONS
// ============================================================================

// Cache query result
export const cacheQuery = (namespace, operation, params, data, options) => {
  const key = queryCache.generateKey(namespace, operation, params);
  return queryCache.set(key, data, options);
};

// Get cached query result
export const getCachedQuery = (namespace, operation, params) => {
  const key = queryCache.generateKey(namespace, operation, params);
  return queryCache.get(key);
};

// Check if query is cached
export const isQueryCached = (namespace, operation, params) => {
  const key = queryCache.generateKey(namespace, operation, params);
  return queryCache.has(key);
};

// Create a memoized version of a function using the cache
export const memoize = (namespace, operation, fn, options = {}) => {
  return async (...args) => {
    const cacheKey = queryCache.generateKey(namespace, operation, args);

    // Try to get from cache first
    const cachedResult = queryCache.get(cacheKey);
    if (cachedResult !== null) {
      return cachedResult;
    }

    // Execute function and cache result
    try {
      const result = await fn(...args);
      queryCache.set(cacheKey, result, options);
      return result;
    } catch (error) {
      // Don't cache errors
      throw error;
    }
  };
};

// Cache with tags for easier invalidation
export const cacheWithTags = (
  namespace,
  operation,
  params,
  data,
  tags,
  ttl
) => {
  const key = queryCache.generateKey(namespace, operation, params);
  return queryCache.set(key, data, { ttl, tags });
};

// ============================================================================
// SPECIFIC CACHE FUNCTIONS
// ============================================================================

// Cache vacation data
export const cacheVacations = (
  params,
  data,
  ttl = QUERY_CACHE_CONFIG.TTL.LONG
) => {
  return cacheQuery("vacations", "list", params, data, {
    ttl,
    tags: ["vacations"],
  });
};

export const getCachedVacations = (params) => {
  return getCachedQuery("vacations", "list", params);
};

// Cache subscriber data with longer TTL
export const cacheSubscribers = (
  params,
  data,
  ttl = QUERY_CACHE_CONFIG.TTL.LONG // Use longer cache for subscriber data
) => {
  return cacheQuery("subscribers", "list", params, data, {
    ttl,
    tags: ["subscribers"],
  });
};

export const getCachedSubscribers = (params) => {
  return getCachedQuery("subscribers", "list", params);
};

// Cache subscriber stats with very long TTL
export const cacheSubscriberStats = (
  data,
  ttl = QUERY_CACHE_CONFIG.TTL.LONG
) => {
  return cacheQuery("subscribers", "stats", {}, data, {
    ttl,
    tags: ["subscribers"],
  });
};

export const getCachedSubscriberStats = () => {
  return getCachedQuery("subscribers", "stats", {});
};

// Cache API responses
export const cacheAPIResponse = (
  endpoint,
  params,
  data,
  ttl = QUERY_CACHE_CONFIG.TTL.SHORT
) => {
  return cacheQuery("api", endpoint, params, data, {
    ttl,
    tags: ["api", endpoint],
  });
};

export const getCachedAPIResponse = (endpoint, params) => {
  return getCachedQuery("api", endpoint, params);
};

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

// Invalidate all cache entries with specific tags
export const invalidateTags = (...tags) => {
  let totalInvalidated = 0;
  tags.forEach((tag) => {
    totalInvalidated += queryCache.invalidateByTag(tag);
  });
  return totalInvalidated;
};

// Invalidate namespace
export const invalidateNamespace = (namespace) => {
  return queryCache.invalidateByNamespace(namespace);
};

// Invalidate by pattern
export const invalidatePattern = (pattern) => {
  return queryCache.invalidateByPattern(pattern);
};

// ============================================================================
// CACHE UTILITIES
// ============================================================================

// Get cache statistics
export const getCacheStats = () => {
  return queryCache.getStats();
};

// Get namespace statistics
export const getNamespaceStats = () => {
  return queryCache.getNamespaceStats();
};

// Clear all cache
export const clearCache = () => {
  return queryCache.clear();
};

// Check cache health
export const isCacheHealthy = () => {
  const stats = queryCache.getStats();
  const hitRate = parseFloat(stats.hitRate);
  const memoryUsage = stats.memoryUsageBytes / (1024 * 1024); // MB

  return {
    healthy:
      hitRate > 40 && memoryUsage < QUERY_CACHE_CONFIG.MAX_MEMORY_MB * 0.9,
    hitRate,
    memoryUsageMB: memoryUsage,
    maxMemoryMB: QUERY_CACHE_CONFIG.MAX_MEMORY_MB,
    recommendations: [
      ...(hitRate < 40
        ? ["Consider increasing TTL values or improving cache key strategies"]
        : []),
      ...(memoryUsage > QUERY_CACHE_CONFIG.MAX_MEMORY_MB * 0.8
        ? ["High memory usage - consider reducing cache size or TTL"]
        : []),
    ],
  };
};

// Export the cache instance for advanced usage
export { queryCache };

// Cleanup on process termination
if (typeof process !== "undefined") {
  process.on("exit", () => {
    queryCache.destroy();
  });

  process.on("SIGINT", () => {
    queryCache.destroy();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    queryCache.destroy();
    process.exit(0);
  });
}
