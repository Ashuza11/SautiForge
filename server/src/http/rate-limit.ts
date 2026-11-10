export type RateLimiterOptions = { limit: number; windowMs: number; now?: () => number; maxKeys?: number };

/**
 * A simple per-visitor limit kept in memory. Serverless instances do not share memory, so this is a
 * best-effort brake on one visitor hammering one instance; the database caps (for example on new
 * volunteers per hour) are the hard limits.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 5000;
  const hits = new Map<string, number[]>();
  return {
    /** True when the visitor may go ahead. */
    allow(key: string): boolean {
      const time = now();
      const recent = (hits.get(key) ?? []).filter((stamp) => time - stamp < options.windowMs);
      if (recent.length >= options.limit) { hits.set(key, recent); return false; }
      recent.push(time);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        for (const [other, stamps] of hits) {
          if (stamps.every((stamp) => time - stamp >= options.windowMs)) hits.delete(other);
        }
      }
      return true;
    },
  };
}

/** The visitor's address as the platform reports it; one shared bucket when it is unknown. */
export function visitorKey(forwardedFor: string | undefined): string {
  return forwardedFor?.split(',')[0]?.trim() || 'unknown';
}
