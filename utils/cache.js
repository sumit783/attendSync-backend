/**
 * Lightweight in-memory TTL cache.
 * No external dependencies — uses a Map + timestamps.
 *
 * Usage:
 *   const cache = require('../utils/cache');
 *   cache.set('key', value, 60);            // cache for 60 seconds
 *   const val = cache.get('key');           // undefined if expired/missing
 *   cache.del('key');
 *   cache.delPattern('org:abc123:');        // delete all keys with this prefix
 *
 *   // Wrap an async fn:
 *   const result = await cache.wrap('my-key', 60, () => expensiveDbCall());
 */

const store = new Map(); // key ? { value, expiresAt }

/**
 * Get a cached value. Returns undefined if missing or expired.
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Store a value with a TTL in seconds.
 */
function set(key, value, ttlSeconds = 60) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Delete a single key.
 */
function del(key) {
  store.delete(key);
}

/**
 * Delete all keys that start with the given prefix.
 */
function delPattern(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/**
 * Cache-aside helper: if cached, return it; else run fn(), cache result, return it.
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<any>} fn  Async factory function
 */
async function wrap(key, ttlSeconds, fn) {
  const cached = get(key);
  if (cached !== undefined) return cached;
  const result = await fn();
  set(key, result, ttlSeconds);
  return result;
}

/**
 * Return current store size (for debugging).
 */
function size() {
  return store.size;
}

module.exports = { get, set, del, delPattern, wrap, size };
