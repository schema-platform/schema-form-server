/**
 * Cache utility — Redis-backed with in-memory fallback.
 *
 * Used for permission caching, session tracking, token blacklist, etc.
 * When Redis is unavailable, falls back to a simple in-memory Map with TTL.
 */
import { redis } from '../config/redis.js'

interface CacheEntry {
  value: string
  expiresAt: number
}

// In-memory fallback store
const memStore = new Map<string, CacheEntry>()

// Clean expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of memStore) {
    if (entry.expiresAt <= now) memStore.delete(key)
  }
}, 5 * 60_000)

function isRedisReady(): boolean {
  return redis.status === 'ready'
}

/**
 * Set a cache entry.
 * @param key Cache key
 * @param value String value (serialize objects with JSON.stringify)
 * @param ttlSeconds TTL in seconds. 0 = no expiry.
 */
export async function cacheSet(key: string, value: string, ttlSeconds = 0): Promise<void> {
  if (isRedisReady()) {
    if (ttlSeconds > 0) {
      await redis.set(key, value, 'EX', ttlSeconds)
    } else {
      await redis.set(key, value)
    }
    return
  }
  // Fallback: in-memory
  memStore.set(key, {
    value,
    expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : Infinity,
  })
}

/**
 * Get a cache entry. Returns null if missing or expired.
 */
export async function cacheGet(key: string): Promise<string | null> {
  if (isRedisReady()) {
    return redis.get(key)
  }
  // Fallback: in-memory
  const entry = memStore.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memStore.delete(key)
    return null
  }
  return entry.value
}

/**
 * Delete a cache entry.
 */
export async function cacheDel(key: string): Promise<void> {
  if (isRedisReady()) {
    await redis.del(key)
    return
  }
  memStore.delete(key)
}

/**
 * Delete all keys matching a pattern. Use '*' wildcard.
 * Warning: In-memory fallback does NOT support pattern deletion.
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  if (isRedisReady()) {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
    }
    return
  }
  // In-memory: scan and delete
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
  for (const key of memStore.keys()) {
    if (regex.test(key)) memStore.delete(key)
  }
}

/**
 * Check if a key exists.
 */
export async function cacheExists(key: string): Promise<boolean> {
  if (isRedisReady()) {
    return (await redis.exists(key)) === 1
  }
  const entry = memStore.get(key)
  if (!entry) return false
  if (entry.expiresAt <= Date.now()) {
    memStore.delete(key)
    return false
  }
  return true
}
