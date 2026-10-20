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
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value, ttl = ttlMs) {
    if (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(key, { value, expiresAt: Date.now() + ttl });
    return value;
  }

  async function wrap(key, producer, ttl = ttlMs) {
    const cached = get(key);
    if (cached !== undefined) return { value: cached, cached: true };
    if (inflight.has(key)) return { value: await inflight.get(key), cached: true };

    const promise = (async () => {
      try {
        const value = await producer();
        set(key, value, ttl);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, promise);
    return { value: await promise, cached: false };
  }

  function clear(prefix = '') {
    for (const key of [...entries.keys()]) {
      if (!prefix || key.startsWith(prefix)) entries.delete(key);
    }
  }

  return { get, set, wrap, clear, size: () => entries.size };
}
