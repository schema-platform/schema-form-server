/**
 * RAG Context Retriever — automatic semantic search before LLM calls.
 *
 * Searches for top-k related schemas based on the user's message,
 * then formats the results for injection into the system prompt's
 * "参考 Schema" section.
 *
 * This module is designed to be called at the start of each agent node,
 * before the LLM is invoked. It catches errors gracefully — if RAG
 * retrieval fails, the agent proceeds without augmented context.
 */

import { semanticSearch, type SearchResult } from '../services/ragService.js'
import { logger } from '../../utils/logger.js'

// ────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────

const RAG_TOP_K = 3
const RAG_MIN_SCORE = 15

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface RagContextOptions {
  /** Number of results to retrieve (default: 3). */
  topK?: number
  /** Minimum similarity score (0-100, default: 15). */
  minScore?: number
  /** Filter by schema type. */
  type?: 'form' | 'search_list'
}

export interface RagContextResult {
  /** The formatted context string to inject into system prompt. Empty if no results. */
  context: string
  /** Raw search results for logging/debugging. */
  results: SearchResult[]
}

// ────────────────────────────────────────────
// Context formatter
// ────────────────────────────────────────────

/**
 * Format search results into a context string for system prompt injection.
 *
 * Output structure:
 * ```
 * ## 参考 Schema
 *
 * 以下是与用户需求语义相关的已有 Schema，可作为参考：
 *
 * 1. **Schema 名称**（类型：form，相似度：85%）
 *    - 组件类型：input, select, table
 *    - 关键字段：userName, phone, email
 *    - 描述：包含 5 种组件类型，字段包括 姓名、手机、邮箱
 *
 * 2. ...
 * ```
 */
export function formatRagContext(results: SearchResult[]): string {
  if (results.length === 0) {
    return ''
  }

  const lines = results.map((r, i) => {
    const typeLabel = r.type === 'form' ? '表单' : '搜索列表'
    const widgetTypes = r.metadata.widgetTypes.length > 0
      ? r.metadata.widgetTypes.join(', ')
      : '无'
    const fieldNames = r.metadata.fieldNames.length > 0
      ? r.metadata.fieldNames.slice(0, 8).join(', ')
      : '无'
    const description = r.metadata.description || '无描述'

    return [
      `${i + 1}. **${r.name}**（类型：${typeLabel}，相似度：${r.score}%）`,
      `   - 组件类型：${widgetTypes}`,
      `   - 关键字段：${fieldNames}`,
      `   - 描述：${description}`,
    ].join('\n')
  })

  return [
    '',
    '## 参考 Schema',
    '',
    '以下是与用户需求语义相关的已有 Schema，可作为参考：',
    '',
    ...lines,
    '',
    '如果用户需求与某个参考 Schema 相似，可以借鉴其结构和字段设计。如需查看完整 Schema，请使用 get_schema_detail 工具。',
  ].join('\n')
}

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

/**
 * Retrieve RAG context for a user message.
 *
 * Performs semantic search on the user's query text and returns
 * formatted context suitable for injection into the system prompt.
 *
 * Errors are caught and logged — returns empty context on failure
 * so the agent can proceed without RAG augmentation.
 */
export async function retrieveRagContext(
  userMessage: string,
  options: RagContextOptions = {},
): Promise<RagContextResult> {
  const { topK = RAG_TOP_K, minScore = RAG_MIN_SCORE, type } = options

  // Skip RAG for very short messages (greetings, single words)
  if (userMessage.trim().length < 4) {
    return { context: '', results: [] }
  }

  try {
    const results = await semanticSearch(userMessage, { limit: topK, minScore, type })

    if (results.length > 0) {
      logger.info({
        msg: 'rag:context:retrieved',
        query: userMessage.slice(0, 100),
        resultCount: results.length,
        topScore: results[0].score,
        topName: results[0].name,
      })
    }

    const context = formatRagContext(results)
    return { context, results }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.warn({
      msg: 'rag:context:error',
      error: errorMessage,
      query: userMessage.slice(0, 100),
    })
    return { context: '', results: [] }
  }
}
