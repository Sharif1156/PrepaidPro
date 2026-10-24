/**
 * Tiny TTL cache with in-flight de-duplication.
 *
 * Two people refreshing the same meter at the same time should cause exactly
 * one request to DESCO, not two. Utility portals are slow and easy to annoy.
 */
export function createCache({ ttlMs = 180_000, maxEntries = 500 } = {}) {
  const entries = new Map();
  const inflight = new Map();

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      if (entry.staleUntil <= Date.now()) entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** An expired value that is still inside its stale window, or undefined. */
  function peekStale(key) {
    const entry = entries.get(key);
    return entry && entry.staleUntil > Date.now() ? entry.value : undefined;
  }

  function set(key, value, ttl = ttlMs, staleMs = 0) {
    if (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    const now = Date.now();
    entries.set(key, { value, expiresAt: now + ttl, staleUntil: now + ttl + staleMs });
    return value;
  }

  function start(key, producer, ttl, staleMs) {
    const promise = (async () => {
      try {
        const value = await producer();
        set(key, value, ttl, staleMs);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  /**
   * `staleMs > 0` turns on stale-while-revalidate: for that long after the value
   * expires it is still returned instantly (flagged `stale: true`) while a fresh
   * copy is fetched in the background for the next request.
   */
  async function wrap(key, producer, ttl = ttlMs, { staleMs = 0 } = {}) {
    const cached = get(key);
    if (cached !== undefined) return { value: cached, cached: true };
    if (inflight.has(key)) return { value: await inflight.get(key), cached: true };

    if (staleMs > 0) {
      const stale = peekStale(key);
      if (stale !== undefined) {
        start(key, producer, ttl, staleMs).catch(() => {});
        return { value: stale, cached: true, stale: true };
      }
    }

    return { value: await start(key, producer, ttl, staleMs), cached: false };
  }

  function clear(prefix = '') {
    for (const key of [...entries.keys()]) {
      if (!prefix || key.startsWith(prefix)) entries.delete(key);
    }
  }

  return { get, set, wrap, clear, size: () => entries.size };
}
