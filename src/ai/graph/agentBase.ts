/**
 * Shared agent infrastructure.
 *
 * Utility functions used across the AI agent system:
 * - OpenAI client singleton
 * - Model configuration per task type
 * - Message building for direct LLM calls (schemaGenerator)
 * - Structured output parsing (think/answer/tip/schema tags)
 * - Retry with exponential backoff
 * - Regex safety
 *
 * Note: LangGraph handles the main agent loop, tool execution,
 * and streaming. These utilities are retained for schemaGenerator.ts
 * and tool implementations.
 */

import OpenAI from 'openai'

// ────────────────────────────────────────────
// OpenAI client (shared singleton)
// ────────────────────────────────────────────

let client: OpenAI | null = null

export function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY environment variable is required.')
    }
    client = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey,
    })
  }
  return client
}

// ────────────────────────────────────────────
// API Key validation (startup check)
// ────────────────────────────────────────────

/**
 * Validate that the DEEPSEEK_API_KEY environment variable is set and
 * has a reasonable format. Call this at module initialization or server
 * startup to fail fast rather than discovering the missing key at request time.
 *
 * Returns the key if valid. Throws with a descriptive error otherwise.
 */
export function validateApiKey(): string {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error(
      'DEEPSEEK_API_KEY environment variable is required. '
      + 'Set it in your .env file or export it before starting the server.',
    )
  }
  if (apiKey.length < 10) {
    throw new Error(
      'DEEPSEEK_API_KEY appears invalid (too short). '
      + 'Check that the key is complete and correctly set.',
    )
  }
  return apiKey
}

// ────────────────────────────────────────────
// Model configuration per task type
// ────────────────────────────────────────────

export type TaskType = 'router' | 'generate_simple' | 'generate_complex' | 'analyze'

/**
 * Select model by task type.
 *
 * Reads model names from environment variables with provider-aware defaults.
 * When LLMManager has a registered provider, uses that provider's model list.
 *
 * - router: intent classification, lightweight and fast
 * - generate_simple: simple generation (single form, single list)
 * - generate_complex: complex reasoning (multi-step, linkage, nested)
 * - analyze: analysis/diagnosis tasks
 */
export function getModelForTask(taskType: TaskType): string {
  // Allow env var overrides for each task type
  const envModel = process.env[`LLM_MODEL_${taskType.toUpperCase()}`]
  if (envModel) return envModel

  // Try to get defaults from LLMManager's current provider
  try {
    // Lazy import to avoid circular dependency at module level
    const { llmManager } = require('../services/llmManager.js') as typeof import('../services/llmManager.js')
    const provider = llmManager.getProvider()

    // Provider-specific model mapping
    const providerDefaults: Record<string, Record<TaskType, string>> = {
      deepseek: {
        router: 'deepseek-chat',
        generate_simple: 'deepseek-v4-pro',
        generate_complex: 'deepseek-v4-pro',
        analyze: 'deepseek-chat',
      },
      openai: {
        router: 'gpt-4o-mini',
        generate_simple: 'gpt-4o',
        generate_complex: 'gpt-4o',
        analyze: 'gpt-4o-mini',
      },
      claude: {
        router: 'claude-3-5-haiku-20241022',
        generate_simple: 'claude-sonnet-4-20250514',
        generate_complex: 'claude-sonnet-4-20250514',
        analyze: 'claude-3-5-haiku-20241022',
      },
    }

    const defaults = providerDefaults[provider.name]
    if (defaults) return defaults[taskType]
    return provider.defaultModel
  } catch {
    // LLMManager not available — use hardcoded DeepSeek defaults
    const fallbackMap: Record<TaskType, string> = {
      router: 'deepseek-chat',
      generate_simple: 'deepseek-v4-pro',
      generate_complex: 'deepseek-v4-pro',
      analyze: 'deepseek-chat',
    }
    return fallbackMap[taskType] ?? 'deepseek-v4-pro'
  }
}

/**
 * Classify task complexity from user message using heuristic rules.
 */
export function classifyTaskComplexity(message: string): TaskType {
  const complexIndicators = [
    '联动', '条件', '动态', '多步', '复杂',
    '同时', '并且', '然后', '之后',
    '审批', '流程', '表单',
    '会签', '或签', '分支',
  ]

  const matchCount = complexIndicators.filter((kw) => message.includes(kw)).length

  if (matchCount >= 2) return 'generate_complex'

  return 'generate_simple'
}

// ────────────────────────────────────────────
// Token estimation & dynamic truncation
// ────────────────────────────────────────────

/**
 * Estimate token count for a message.
 *
 * Uses a simple heuristic: ~1.5 tokens per Chinese character,
 * ~0.75 tokens per English word, plus overhead for JSON/structured content.
 * This is intentionally fast (no API call) and errs on the side of
 * over-counting to avoid context overflow.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  // Count CJK characters (each ~1.5 tokens)
  const cjkCount = (text.match(/[一-鿿㐀-䶿]/g) ?? []).length
  // Count non-CJK characters (rough: 4 chars ≈ 1 token)
  const nonCjkLength = text.length - cjkCount
  // Overhead for JSON structure (brackets, quotes, keys)
  const jsonOverhead = (text.match(/[{}[\]":,]/g) ?? []).length * 0.1
  return Math.ceil(cjkCount * 1.5 + nonCjkLength / 4 + jsonOverhead)
}

/**
 * Estimate token count for a LangGraph BaseMessage.
 * Handles string content, content arrays, and tool_calls arguments.
 */
export function estimateMessageTokens(message: { content?: unknown; tool_calls?: unknown[]; additional_kwargs?: unknown }): number {
  let tokens = 0

  // Content
  if (typeof message.content === 'string') {
    tokens += estimateTokens(message.content)
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (typeof part === 'string') {
        tokens += estimateTokens(part)
      } else if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
        tokens += estimateTokens((part as { text: string }).text)
      }
    }
  }

  // Tool calls (AIMessage with tool_calls)
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      const args = (tc as { args?: unknown }).args
      if (typeof args === 'string') {
        tokens += estimateTokens(args)
      } else if (args && typeof args === 'object') {
        tokens += estimateTokens(JSON.stringify(args))
      }
    }
  }

  // reasoning_content (DeepSeek chain-of-thought)
  const ak = message.additional_kwargs as Record<string, unknown> | undefined
  if (ak && typeof ak.reasoning_content === 'string') {
    tokens += estimateTokens(ak.reasoning_content)
  }

  // Base overhead per message (role, formatting, etc.)
  tokens += 4

  return tokens
}

/** Default token budget for conversation history (non-graph path). */
const DEFAULT_HISTORY_TOKEN_BUDGET = 4000

/**
 * Token budget for LangGraph agent nodes.
 *
 * DeepSeek v4-pro has 128K context window. We allocate:
 * - ~8K for system prompt
 * - ~2K for the new user message
 * - ~60K for conversation history
 * - Reserve the rest for LLM response and safety margin
 */
const LANGGRAPH_HISTORY_TOKEN_BUDGET = 60_000

/** Minimum number of recent messages to always keep. */
const MIN_KEEP_MESSAGES = 4

/**
 * Truncate conversation history based on token budget.
 *
 * Strategy:
 * 1. Always keep the first message (original user request) if possible
 * 2. Always keep the last MIN_KEEP_MESSAGES messages
 * 3. Fill the middle from newest to oldest until token budget is exhausted
 * 4. Never break a tool_calls → ToolMessage chain
 *
 * This replaces the fixed turn-count truncation to better handle
 * conversations with varying message lengths (tool results can be huge).
 */
export function truncateMessages<T extends { constructor: { name: string }; content?: unknown }>(
  messages: readonly T[],
  tokenBudget: number = DEFAULT_HISTORY_TOKEN_BUDGET,
): T[] {
  const historyMessages = messages.slice(0, -1)

  if (historyMessages.length <= MIN_KEEP_MESSAGES) {
    return [...historyMessages]
  }

  // Estimate tokens per message
  const tokenCosts = historyMessages.map((m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
    return estimateTokens(content)
  })

  // Always include the last MIN_KEEP_MESSAGES messages
  const alwaysIncludeStart = historyMessages.length - MIN_KEEP_MESSAGES
  let totalTokens = 0
  for (let i = alwaysIncludeStart; i < historyMessages.length; i++) {
    totalTokens += tokenCosts[i]
  }

  // Walk backwards from the "always include" boundary to fill budget
  let cutoffIndex = alwaysIncludeStart
  for (let i = alwaysIncludeStart - 1; i >= 0; i--) {
    if (totalTokens + tokenCosts[i] > tokenBudget) break
    totalTokens += tokenCosts[i]
    cutoffIndex = i
  }

  // Always try to include the first message (original user request)
  if (cutoffIndex > 0 && cutoffIndex <= 1) {
    cutoffIndex = 0
  }

  // Ensure cutoff doesn't break a tool_calls → ToolMessage chain
  cutoffIndex = findSafeCutoffPoint(historyMessages, cutoffIndex)

  return historyMessages.slice(cutoffIndex)
}

/**
 * Find a safe cutoff point that doesn't break tool_calls → ToolMessage chains.
 *
 * If the message at cutoffIndex is a ToolMessage, walk back to before
 * the corresponding AIMessage with tool_calls.
 * If the message before cutoffIndex is an AIMessage with tool_calls,
 * walk forward to include the ToolMessages.
 */
function findSafeCutoffPoint<T extends { constructor: { name: string } }>(
  messages: readonly T[],
  cutoffIndex: number,
): number {
  // Ensure we don't land in the middle of a tool chain
  while (cutoffIndex > 0 && cutoffIndex < messages.length) {
    const msg = messages[cutoffIndex]
    const prevMsg = messages[cutoffIndex - 1]

    // If previous message is AIMessage with tool_calls, current must be ToolMessage
    if (prevMsg.constructor.name === 'AIMessage' || prevMsg.constructor.name === 'AIMessageChunk') {
      const hasToolCalls = (prevMsg as unknown as { tool_calls?: unknown[] }).tool_calls?.length
      if (hasToolCalls && msg.constructor.name !== 'ToolMessage') {
        cutoffIndex--
        continue
      }
    }

    // If current message is ToolMessage, we're inside a tool chain — move back
    if (msg.constructor.name === 'ToolMessage') {
      cutoffIndex--
      continue
    }

    break
  }

  return cutoffIndex
}

/**
 * Find safe cutoff using instanceof checks (for LangGraph BaseMessage objects).
 *
 * This variant works with actual LangGraph message instances where
 * constructor.name may differ due to bundling/minification.
 */
function findSafeCutoffPointForLangGraph<T extends { constructor: Function }>(
  messages: readonly T[],
  cutoffIndex: number,
): number {
  // Lazily import to avoid circular deps at module level
  const isAiMessage = (m: T): boolean => {
    const name = m.constructor.name
    return name === 'AIMessage' || name === 'AIMessageChunk'
  }
  const hasToolCalls = (m: T): boolean => {
    const tc = (m as unknown as { tool_calls?: unknown[] }).tool_calls
    return Array.isArray(tc) && tc.length > 0
  }
  const isToolMessage = (m: T): boolean => m.constructor.name === 'ToolMessage'

  while (cutoffIndex > 0 && cutoffIndex < messages.length) {
    const msg = messages[cutoffIndex]
    const prevMsg = messages[cutoffIndex - 1]

    // If previous is AIMessage with tool_calls, current must be ToolMessage
    if (isAiMessage(prevMsg) && hasToolCalls(prevMsg) && !isToolMessage(msg)) {
      cutoffIndex--
      continue
    }

    // If current is ToolMessage, we're inside a tool chain — move back
    if (isToolMessage(msg)) {
      cutoffIndex--
      continue
    }

    break
  }

  return cutoffIndex
}

/**
 * Truncate messages for LangGraph agent nodes.
 *
 * Uses a larger token budget (60K) than the non-graph path since
 * DeepSeek v4-pro has 128K context. The strategy is:
 *
 * 1. If total tokens fit within budget, return all messages unchanged
 * 2. Always keep the last MIN_KEEP_MESSAGES messages (recent tool call results are critical)
 * 3. Keep the first HumanMessage (original user request) if possible
 * 4. Fill the middle from newest to oldest until budget is exhausted
 * 5. Never break a tool_calls -> ToolMessage chain
 * 6. If first message gets dropped, insert a summary placeholder
 *
 * @param messages - LangGraph state.messages (BaseMessage[])
 * @param tokenBudget - max tokens for history (default 60K)
 * @returns truncated message array (new array, does not mutate input)
 */
export function truncateMessagesForLangGraph<T extends { constructor: Function; content?: unknown; tool_calls?: unknown[]; additional_kwargs?: unknown }>(
  messages: readonly T[],
  tokenBudget: number = LANGGRAPH_HISTORY_TOKEN_BUDGET,
): T[] {
  if (messages.length <= MIN_KEEP_MESSAGES) {
    return [...messages]
  }

  // Fast path: estimate total tokens first
  let totalTokens = 0
  const tokenCosts: number[] = []
  for (const m of messages) {
    const cost = estimateMessageTokens(m)
    tokenCosts.push(cost)
    totalTokens += cost
  }

  // If within budget, return as-is
  if (totalTokens <= tokenBudget) {
    return [...messages]
  }

  console.log(`[truncateMessages] 触发截断: ${totalTokens} tokens > ${tokenBudget} budget, ${messages.length} messages`)

  // Strategy: keep last MIN_KEEP_MESSAGES + fill from newest to oldest
  const alwaysIncludeStart = messages.length - MIN_KEEP_MESSAGES
  let usedTokens = 0
  for (let i = alwaysIncludeStart; i < messages.length; i++) {
    usedTokens += tokenCosts[i]
  }

  // Walk backwards from alwaysIncludeStart to fill budget
  let cutoffIndex = alwaysIncludeStart
  for (let i = alwaysIncludeStart - 1; i >= 0; i--) {
    if (usedTokens + tokenCosts[i] > tokenBudget) break
    usedTokens += tokenCosts[i]
    cutoffIndex = i
  }

  // Always try to include the first message (original user request)
  if (cutoffIndex > 0 && cutoffIndex <= 1) {
    cutoffIndex = 0
  }

  // Ensure cutoff doesn't break a tool_calls → ToolMessage chain
  cutoffIndex = findSafeCutoffPointForLangGraph(messages, cutoffIndex)

  const truncated = messages.slice(cutoffIndex)

  console.log(`[truncateMessages] 截断完成: ${messages.length} -> ${truncated.length} messages, dropped ${cutoffIndex} from front`)

  return truncated
}

/**
 * Build LLM message array from conversation state.
 *
 * Used by schemaGenerator.ts for direct (non-graph) LLM calls.
 * LangGraph nodes handle message management via the graph state.
 *
 * Uses token-budget-based truncation instead of fixed turn count.
 */
export function buildMessages(
  state: { messages: Array<{ role: string; content: string }>; [key: string]: unknown },
  systemPrompt: string,
  buildUserMessage: (state: { messages: Array<{ role: string; content: string }>; [key: string]: unknown }) => string,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ]

  const historyMessages = state.messages.slice(0, -1)

  // Token-budget-based truncation
  const TOKEN_BUDGET = 4000
  let totalTokens = 0

  // Always include the last 4 messages (2 turns)
  const alwaysIncludeStart = Math.max(0, historyMessages.length - 4)
  for (let i = alwaysIncludeStart; i < historyMessages.length; i++) {
    const msg = historyMessages[i]
    if (msg.role === 'user' || msg.role === 'assistant') {
      totalTokens += estimateTokens(msg.content)
    }
  }

  // Find cutoff by walking backwards from alwaysIncludeStart
  let cutoffIndex = alwaysIncludeStart
  for (let i = alwaysIncludeStart - 1; i >= 0; i--) {
    const msg = historyMessages[i]
    if (msg.role !== 'user' && msg.role !== 'assistant') continue
    const cost = estimateTokens(msg.content)
    if (totalTokens + cost > TOKEN_BUDGET) break
    totalTokens += cost
    cutoffIndex = i
  }

  // Build the truncated history in original order
  const truncatedHistory = historyMessages.slice(cutoffIndex)

  for (const msg of truncatedHistory) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      const content = msg.content.length > 2000
        ? msg.content.slice(0, 2000) + '...(已截断)'
        : msg.content
      messages.push({ role: 'assistant', content })
    }
  }

  messages.push({ role: 'user', content: buildUserMessage(state) })

  return messages
}

// ────────────────────────────────────────────
// Structured output parser
// ────────────────────────────────────────────

export interface ParsedStructuredOutput {
  thinking: string
  answer: string
  tip: string
  schemaRaw: string
  hasStructuredTags: boolean
}

export function parseStructuredOutput(raw: string): ParsedStructuredOutput {
  const extract = (tag: string): string => {
    const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`)
    const m = raw.match(re)
    return m ? m[1].trim() : ''
  }

  const thinking = extract('think')
  const answer = extract('answer')
  const tip = extract('tip')
  const schemaRaw = extract('schema')

  return {
    thinking,
    answer,
    tip,
    schemaRaw,
    hasStructuredTags: !!(thinking || answer || tip || schemaRaw),
  }
}

// ────────────────────────────────────────────
// Regex safety
// ────────────────────────────────────────────

/**
 * Escape special regex characters in a string for safe use in $regex queries.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ────────────────────────────────────────────
// Agent metrics
// ────────────────────────────────────────────

type AgentName = 'thinker' | 'editor' | 'flow' | 'page' | 'general' | 'summarizer' | 'router'
type Operation = 'invoke' | 'tool_call' | 'think' | 'stream'

/**
 * Execute a function with performance metrics recording.
 *
 * Records duration, success/failure, and optional token usage
 * to the AgentMetric collection.
 */
export async function executeWithMetrics<T>(
  agentName: AgentName,
  operation: Operation,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    const duration = Date.now() - start

    // Extract token usage from LLM response if present
    const tokenUsage = extractTokenUsage(result)

    const { AgentMetricModel } = await import('../models/monitor.js')
    await AgentMetricModel.create({
      _id: (await import('uuid')).v4(),
      agentName,
      operation,
      duration,
      success: true,
      tokenUsage,
      metadata,
    })

    return result
  } catch (err) {
    const duration = Date.now() - start
    const error = err instanceof Error ? err.message : String(err)

    const { AgentMetricModel } = await import('../models/monitor.js')
    await AgentMetricModel.create({
      _id: (await import('uuid')).v4(),
      agentName,
      operation,
      duration,
      success: false,
      error,
      metadata,
    })

    throw err
  }
}

/**
 * Wrap an agent node function with metrics recording.
 *
 * Returns a new function with the same signature that records
 * execution metrics on every invocation.
 */
export function withAgentMetrics<TState, TResult>(
  agentName: AgentName,
  operation: Operation,
  nodeFn: (state: TState) => Promise<TResult>,
): (state: TState) => Promise<TResult> {
  return async (state: TState): Promise<TResult> => {
    return executeWithMetrics(agentName, operation, () => nodeFn(state))
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTokenUsage(result: any): { prompt?: number; completion?: number; total?: number } | undefined {
  if (!result || typeof result !== 'object') return undefined
  const usage = result.usage
  if (!usage || typeof usage !== 'object') return undefined
  return {
    prompt: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    completion: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    total: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
  }
}

// ────────────────────────────────────────────
// Retry with exponential backoff
// ────────────────────────────────────────────

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

/**
 * Retry a function with exponential backoff for transient errors.
 * Only retries on network errors and 429/500/502/503/504 status codes.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === maxRetries) break

      const status = (err as { status?: number }).status
      const isTransient = !status || [429, 500, 502, 503, 504].includes(status)
      if (!isTransient) break

      const delay = BASE_DELAY_MS * Math.pow(2, attempt)
      console.warn(`[withRetry] 重试 ${attempt + 1}/${maxRetries}，等待 ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}

/**
 * 带重试的流式 LLM 调用包装器。
 *
 * 用于 Agent 节点的 model.stream() 调用，
 * 对 429/5xx 错误自动重试，400 参数错误不重试。
 */
export async function streamWithRetry<T>(
  agentName: string,
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === maxRetries) break

      const status = (err as { status?: number }).status
      // 400 不重试（参数错误），429/5xx 重试
      if (status && status < 500 && status !== 429) break

      const delay = BASE_DELAY_MS * Math.pow(2, attempt)
      console.warn(`[${agentName}] LLM 流式调用重试 ${attempt + 1}/${maxRetries}，等待 ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}
