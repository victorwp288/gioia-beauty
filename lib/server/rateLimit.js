export function createFixedWindowRateLimiter({
  limit,
  windowMs,
  maxKeys = 1_000,
  now = () => Date.now(),
}) {
  const buckets = new Map();

  return {
    check(key) {
      const currentTime = now();
      const existing = buckets.get(key);

      if (!existing || currentTime >= existing.resetAt) {
        if (!existing && buckets.size >= maxKeys) {
          for (const [bucketKey, bucket] of buckets) {
            if (currentTime >= bucket.resetAt) buckets.delete(bucketKey);
          }

          if (buckets.size >= maxKeys) {
            buckets.delete(buckets.keys().next().value);
          }
        }

        const resetAt = currentTime + windowMs;
        buckets.set(key, { count: 1, resetAt });
        return { allowed: true, remaining: limit - 1, resetAt };
      }

      if (existing.count >= limit) {
        return { allowed: false, remaining: 0, resetAt: existing.resetAt };
      }

      existing.count += 1;
      return {
        allowed: true,
        remaining: limit - existing.count,
        resetAt: existing.resetAt,
      };
    },
  };
}
