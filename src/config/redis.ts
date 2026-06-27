/**
 * Redis configuration
 *
 * Connection is lazy — only connects when first command is issued.
 * Falls back to in-memory Map if REDIS_URL is not set (local dev without Redis).
 */
import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) return null // stop retrying
    return Math.min(times * 200, 2000)
  },
  lazyConnect: true,
  enableReadyCheck: false,
})

redis.on('error', (err) => {
  // Suppress connection errors in dev — Redis is optional
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[redis] Connection failed, falling back to in-memory:', err.message)
  }
})

/**
 * Try to connect. Returns true if connected, false if failed.
 * In dev, failure is non-fatal.
 */
export async function connectRedis(): Promise<boolean> {
  try {
    await redis.connect()
    console.log('[redis] Connected to', REDIS_URL)
    return true
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[redis] Failed to connect:', (err as Error).message)
    }
    return false
  }
}
