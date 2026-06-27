/**
 * AI Agent Graph — Checkpointer for state persistence.
 *
 * Uses MongoDB-backed checkpointer for persistent state storage.
 * Thread state survives process restarts and serverless cold starts.
 *
 * Falls back to MemorySaver if MongoDB is not connected (e.g., during
 * unit tests or when the DB connection hasn't been established yet).
 */

import { MemorySaver } from '@langchain/langgraph'
import { MongoDBCheckpointer } from './checkpointMongo.js'
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'

function createCheckpointer(): BaseCheckpointSaver {
  if (process.env.NODE_ENV === 'production') {
    // 生产环境：必须用 MongoDB，失败则抛错阻止启动
    const cp = new MongoDBCheckpointer()
    console.log('[checkpointer] MongoDB checkpointer 初始化成功')
    return cp
  }

  // 开发环境：优先 MongoDB，降级 MemorySaver
  try {
    const cp = new MongoDBCheckpointer()
    console.log('[checkpointer] MongoDB checkpointer 初始化成功')
    return cp
  } catch (err) {
    console.warn('[checkpointer] MongoDB 不可用，降级到 MemorySaver:', err instanceof Error ? err.message : err)
    return new MemorySaver() as unknown as BaseCheckpointSaver
  }
}

/** Singleton checkpointer — backed by MongoDB for persistent state. */
const checkpointer = createCheckpointer()

export { checkpointer }
