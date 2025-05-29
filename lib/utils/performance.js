// Performance monitoring and optimization utilities for Gioia Beauty
import { FEATURE_FLAGS } from "./constants";

// Performance monitoring configuration
const PERFORMANCE_CONFIG = {
  ENABLE_MONITORING: FEATURE_FLAGS.ENABLE_ANALYTICS,
  SLOW_QUERY_THRESHOLD: 1000, // 1 second
  SLOW_RENDER_THRESHOLD: 16.67, // 60fps target
  MEMORY_WARNING_THRESHOLD: 100 * 1024 * 1024, // 100MB
  MAX_METRICS_HISTORY: 1000,
  METRICS_CLEANUP_INTERVAL: 5 * 60 * 1000, // 5 minutes
};

// Performance metrics store
class PerformanceMonitor {
  constructor() {
    this.enabled = PERFORMANCE_CONFIG.ENABLE_MONITORING;
    this.metrics = {
      queries: [],
      renders: [],
      memory: [],
      errors: [],
      userInteractions: [],
    };

    this.timers = new Map();
    this.counters = new Map();

    // Start monitoring if enabled
    if (this.enabled && typeof window !== "undefined") {
      this.startMonitoring();
    }
  }

  // Start performance monitoring
  startMonitoring() {
    // Monitor memory usage
    this.startMemoryMonitoring();

    // Monitor slow tasks
    this.startSlowTaskMonitoring();

    // Clean up metrics periodically
    this.startMetricsCleanup();

    // Monitor page load performance
    this.monitorPageLoad();
  }

  // Record query performance
  recordQuery(name, duration, params = {}) {
    if (!this.enabled) return;

    const metric = {
      name,
      duration,
      params,
      timestamp: Date.now(),
      slow: duration > PERFORMANCE_CONFIG.SLOW_QUERY_THRESHOLD,
    };

    this.metrics.queries.push(metric);
    this.trimMetrics("queries");

    // Log slow queries
    if (metric.slow) {
      console.warn(`Slow query detected: ${name} took ${duration}ms`, params);
    }
  }

  // Record component render performance
  recordRender(componentName, duration, props = {}) {
    if (!this.enabled) return;

    const metric = {
      componentName,
      duration,
      props: Object.keys(props),
      timestamp: Date.now(),
      slow: duration > PERFORMANCE_CONFIG.SLOW_RENDER_THRESHOLD,
    };

    this.metrics.renders.push(metric);
    this.trimMetrics("renders");

    // Log slow renders
    if (metric.slow) {
      console.warn(`Slow render detected: ${componentName} took ${duration}ms`);
    }
  }

  // Record memory usage
  recordMemoryUsage() {
    if (
      !this.enabled ||
      typeof window === "undefined" ||
      !window.performance?.memory
    ) {
      return;
    }

    const memory = window.performance.memory;
    const metric = {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      limit: memory.jsHeapSizeLimit,
      timestamp: Date.now(),
      warning:
        memory.usedJSHeapSize > PERFORMANCE_CONFIG.MEMORY_WARNING_THRESHOLD,
    };

    this.metrics.memory.push(metric);
    this.trimMetrics("memory");

    // Log memory warnings
    if (metric.warning) {
      console.warn(
        `High memory usage detected: ${(metric.used / 1024 / 1024).toFixed(
          2
        )}MB`
      );
    }
  }

  // Record error with performance context
  recordError(error, context = {}) {
    if (!this.enabled) return;

    const metric = {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: Date.now(),
      memoryUsage: this.getCurrentMemoryUsage(),
    };

    this.metrics.errors.push(metric);
    this.trimMetrics("errors");
  }

  // Record user interaction performance
  recordUserInteraction(action, duration, target = null) {
    if (!this.enabled) return;

    const metric = {
      action,
      duration,
      target,
      timestamp: Date.now(),
      slow: duration > 100, // 100ms threshold for interactions
    };

    this.metrics.userInteractions.push(metric);
    this.trimMetrics("userInteractions");
  }

  // Start a performance timer
  startTimer(name) {
    this.timers.set(name, {
      start: performance.now(),
      timestamp: Date.now(),
    });
  }

  // End a performance timer and record the result
  endTimer(name, category = "general") {
    const timer = this.timers.get(name);
    if (!timer) return null;

    const duration = performance.now() - timer.start;
    this.timers.delete(name);

    // Record based on category
    switch (category) {
      case "query":
        this.recordQuery(name, duration);
        break;
      case "render":
        this.recordRender(name, duration);
        break;
      case "interaction":
        this.recordUserInteraction(name, duration);
        break;
      default:
        // Generic performance metric
        this.incrementCounter(`${category}.${name}`, duration);
    }

    return duration;
  }

  // Increment a counter
  incrementCounter(name, value = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  // Get performance statistics
  getStats() {
    if (!this.enabled) return null;

    const queries = this.metrics.queries;
    const renders = this.metrics.renders;
    const interactions = this.metrics.userInteractions;

    return {
      queries: {
        total: queries.length,
        slow: queries.filter((q) => q.slow).length,
        avgDuration: this.calculateAverage(queries.map((q) => q.duration)),
        maxDuration: Math.max(...queries.map((q) => q.duration), 0),
      },
      renders: {
        total: renders.length,
        slow: renders.filter((r) => r.slow).length,
        avgDuration: this.calculateAverage(renders.map((r) => r.duration)),
        maxDuration: Math.max(...renders.map((r) => r.duration), 0),
      },
      interactions: {
        total: interactions.length,
        slow: interactions.filter((i) => i.slow).length,
        avgDuration: this.calculateAverage(interactions.map((i) => i.duration)),
        maxDuration: Math.max(...interactions.map((i) => i.duration), 0),
      },
      memory: this.getMemoryStats(),
      errors: this.metrics.errors.length,
      counters: Object.fromEntries(this.counters),
    };
  }

  // Get memory statistics
  getMemoryStats() {
    const memoryMetrics = this.metrics.memory;
    if (memoryMetrics.length === 0) return null;

    const latest = memoryMetrics[memoryMetrics.length - 1];
    return {
      current: {
        used: latest.used,
        total: latest.total,
        limit: latest.limit,
        usedMB: (latest.used / 1024 / 1024).toFixed(2),
        totalMB: (latest.total / 1024 / 1024).toFixed(2),
      },
      warnings: memoryMetrics.filter((m) => m.warning).length,
    };
  }

  // Get slow operations
  getSlowOperations() {
    return {
      queries: this.metrics.queries.filter((q) => q.slow).slice(-10),
      renders: this.metrics.renders.filter((r) => r.slow).slice(-10),
      interactions: this.metrics.userInteractions
        .filter((i) => i.slow)
        .slice(-10),
    };
  }

  // Get recent errors
  getRecentErrors() {
    return this.metrics.errors.slice(-10);
  }

  // Clear all metrics
  clearMetrics() {
    this.metrics = {
      queries: [],
      renders: [],
      memory: [],
      errors: [],
      userInteractions: [],
    };
    this.counters.clear();
  }

  // Calculate average of array
  calculateAverage(numbers) {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  }

  // Trim metrics to max size
  trimMetrics(type) {
    const metrics = this.metrics[type];
    if (metrics.length > PERFORMANCE_CONFIG.MAX_METRICS_HISTORY) {
      metrics.splice(
        0,
        metrics.length - PERFORMANCE_CONFIG.MAX_METRICS_HISTORY
      );
    }
  }

  // Get current memory usage
  getCurrentMemoryUsage() {
    if (typeof window === "undefined" || !window.performance?.memory) {
      return null;
    }

    const memory = window.performance.memory;
    return {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      usedMB: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2),
    };
  }

  // Start memory monitoring
  startMemoryMonitoring() {
    setInterval(() => {
      this.recordMemoryUsage();
    }, 30000); // Every 30 seconds
  }

  // Start slow task monitoring using Long Tasks API
  startSlowTaskMonitoring() {
    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) {
              // Tasks longer than 50ms
              console.warn(`Long task detected: ${entry.duration}ms`);
              this.incrementCounter("longTasks.count");
              this.incrementCounter("longTasks.totalDuration", entry.duration);
            }
          }
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch (error) {
        // Long Tasks API not supported
      }
    }
  }

  // Start metrics cleanup
  startMetricsCleanup() {
    setInterval(() => {
      const now = Date.now();
      const cutoff = now - 24 * 60 * 60 * 1000; // 24 hours ago

      // Clean old metrics
      Object.keys(this.metrics).forEach((key) => {
        this.metrics[key] = this.metrics[key].filter(
          (metric) => metric.timestamp > cutoff
        );
      });
    }, PERFORMANCE_CONFIG.METRICS_CLEANUP_INTERVAL);
  }

  // Monitor page load performance
  monitorPageLoad() {
    window.addEventListener("load", () => {
      setTimeout(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        if (navigation) {
          this.recordQuery(
            "page_load",
            navigation.loadEventEnd - navigation.fetchStart
          );

          // Record specific timing metrics
          this.incrementCounter(
            "pageLoad.dns",
            navigation.domainLookupEnd - navigation.domainLookupStart
          );
          this.incrementCounter(
            "pageLoad.connect",
            navigation.connectEnd - navigation.connectStart
          );
          this.incrementCounter(
            "pageLoad.ttfb",
            navigation.responseStart - navigation.requestStart
          );
          this.incrementCounter(
            "pageLoad.download",
            navigation.responseEnd - navigation.responseStart
          );
          this.incrementCounter(
            "pageLoad.domComplete",
            navigation.domComplete - navigation.domLoading
          );
        }
      }, 0);
    });
  }
}

// Create singleton instance
const performanceMonitor = new PerformanceMonitor();

// ============================================================================
// REACT PERFORMANCE UTILITIES
// ============================================================================

// Higher-order component for performance monitoring
export const withPerformanceMonitoring = (WrappedComponent, componentName) => {
  const PerformanceMonitoredComponent = React.memo((props) => {
    const startTime = React.useRef();

    React.useLayoutEffect(() => {
      startTime.current = performance.now();
    });

    React.useEffect(() => {
      if (startTime.current) {
        const duration = performance.now() - startTime.current;
        performanceMonitor.recordRender(
          componentName || WrappedComponent.name,
          duration,
          props
        );
      }
    });

    return React.createElement(WrappedComponent, props);
  });

  PerformanceMonitoredComponent.displayName = `withPerformanceMonitoring(${
    componentName || WrappedComponent.name || "Component"
  })`;

  return PerformanceMonitoredComponent;
};

// Hook for measuring component render time
export const useRenderTime = (componentName) => {
  const startTime = React.useRef();

  React.useLayoutEffect(() => {
    startTime.current = performance.now();
  });

  React.useEffect(() => {
    if (startTime.current) {
      const duration = performance.now() - startTime.current;
      performanceMonitor.recordRender(componentName, duration);
    }
  });
};

// Hook for measuring async operations
export const useAsyncTiming = (operationName) => {
  return React.useCallback(
    async (asyncFn) => {
      performanceMonitor.startTimer(operationName);
      try {
        const result = await asyncFn();
        performanceMonitor.endTimer(operationName, "query");
        return result;
      } catch (error) {
        performanceMonitor.endTimer(operationName, "query");
        performanceMonitor.recordError(error, { operation: operationName });
        throw error;
      }
    },
    [operationName]
  );
};

// ============================================================================
// OPTIMIZATION UTILITIES
// ============================================================================

// Debounce function with performance tracking
export const createDebounce = (fn, delay, name = "debounced_function") => {
  let timeoutId;
  let callCount = 0;

  return (...args) => {
    callCount++;
    clearTimeout(timeoutId);

    timeoutId = setTimeout(() => {
      performanceMonitor.startTimer(`${name}_execution`);
      fn(...args);
      performanceMonitor.endTimer(`${name}_execution`, "interaction");
      performanceMonitor.incrementCounter(`${name}.calls`, callCount);
      callCount = 0;
    }, delay);
  };
};

// Throttle function with performance tracking
export const createThrottle = (fn, limit, name = "throttled_function") => {
  let inThrottle;
  let callCount = 0;

  return (...args) => {
    callCount++;

    if (!inThrottle) {
      performanceMonitor.startTimer(`${name}_execution`);
      fn(...args);
      performanceMonitor.endTimer(`${name}_execution`, "interaction");
      performanceMonitor.incrementCounter(`${name}.calls`, callCount);

      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        callCount = 0;
      }, limit);
    }
  };
};

// Memoize function with cache size monitoring
export const createMemoize = (
  fn,
  keyGenerator = JSON.stringify,
  maxCacheSize = 100
) => {
  const cache = new Map();
  let hitCount = 0;
  let missCount = 0;

  return (...args) => {
    const key = keyGenerator(args);

    if (cache.has(key)) {
      hitCount++;
      performanceMonitor.incrementCounter("memoize.hits");
      return cache.get(key);
    }

    missCount++;
    performanceMonitor.incrementCounter("memoize.misses");

    const result = fn(...args);

    // Manage cache size
    if (cache.size >= maxCacheSize) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    cache.set(key, result);
    return result;
  };
};

// ============================================================================
// PERFORMANCE ANALYSIS
// ============================================================================

// Analyze performance bottlenecks
export const analyzePerformance = () => {
  const stats = performanceMonitor.getStats();
  if (!stats) return null;

  const issues = [];
  const recommendations = [];

  // Check for slow queries
  if (stats.queries.slow > 0) {
    issues.push(`${stats.queries.slow} slow database queries detected`);
    recommendations.push(
      "Consider optimizing database queries or implementing caching"
    );
  }

  // Check for slow renders
  if (stats.renders.slow > 0) {
    issues.push(`${stats.renders.slow} slow component renders detected`);
    recommendations.push(
      "Consider using React.memo, useMemo, or useCallback for optimization"
    );
  }

  // Check for slow interactions
  if (stats.interactions.slow > 0) {
    issues.push(`${stats.interactions.slow} slow user interactions detected`);
    recommendations.push("Consider debouncing or throttling user interactions");
  }

  // Check memory usage
  if (stats.memory?.warnings > 0) {
    issues.push(`${stats.memory.warnings} memory warnings detected`);
    recommendations.push(
      "Consider implementing memory optimization strategies"
    );
  }

  // Check error rate
  if (stats.errors > 10) {
    issues.push(`High error rate detected: ${stats.errors} errors`);
    recommendations.push(
      "Review error logs and implement proper error handling"
    );
  }

  return {
    issues,
    recommendations,
    stats,
    score: calculatePerformanceScore(stats),
  };
};

// Calculate performance score (0-100)
const calculatePerformanceScore = (stats) => {
  let score = 100;

  // Deduct points for issues
  score -= stats.queries.slow * 5;
  score -= stats.renders.slow * 3;
  score -= stats.interactions.slow * 2;
  score -= stats.errors * 1;

  if (stats.memory?.warnings > 0) {
    score -= stats.memory.warnings * 10;
  }

  return Math.max(0, Math.min(100, score));
};

// ============================================================================
// EXPORTS
// ============================================================================

// Export performance monitoring functions
export const {
  recordQuery,
  recordRender,
  recordError,
  recordUserInteraction,
  startTimer,
  endTimer,
  incrementCounter,
  getStats,
  getSlowOperations,
  getRecentErrors,
  clearMetrics,
} = performanceMonitor;

// Export utilities
export { performanceMonitor, PERFORMANCE_CONFIG };

// Performance monitoring decorator for async functions
export const monitorAsync = (name, category = "query") => {
  return (target, propertyKey, descriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args) {
      performanceMonitor.startTimer(name);
      try {
        const result = await originalMethod.apply(this, args);
        performanceMonitor.endTimer(name, category);
        return result;
      } catch (error) {
        performanceMonitor.endTimer(name, category);
        performanceMonitor.recordError(error, { method: name, args });
        throw error;
      }
    };

    return descriptor;
  };
};

// Performance monitoring for function calls
export const measurePerformance = async (name, fn, category = "general") => {
  performanceMonitor.startTimer(name);
  try {
    const result = await fn();
    performanceMonitor.endTimer(name, category);
    return result;
  } catch (error) {
    performanceMonitor.endTimer(name, category);
    performanceMonitor.recordError(error, { operation: name });
    throw error;
  }
};
