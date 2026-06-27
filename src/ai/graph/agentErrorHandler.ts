/**
 * Agent 统一错误处理层。
 *
 * - 原始错误只写控制台日志（含完整堆栈）
 * - 返回用户友好的 AIMessage（不中断图执行）
 * - 支持降级内容（如 summarizer 降级为任务列表）
 */

import { AIMessage } from '@langchain/core/messages'
import { streamWithRetry } from './agentBase.js'

// ────────────────────────────────────────────
// 错误分类 → 用户友好消息
// ────────────────────────────────────────────

const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  context_length: '对话内容过长，请新建对话或缩短消息',
  invalid_api_key: 'AI 服务配置异常，请联系管理员',
  rate_limit: 'AI 服务繁忙，请稍后重试',
  timeout: 'AI 响应超时，请稍后重试',
  network: '网络连接异常，请检查网络后重试',
  empty_response: 'AI 未返回有效内容，请重试',
}

export type ErrorType = keyof typeof USER_FRIENDLY_MESSAGES | 'unknown'

/**
 * 根据错误消息内容分类错误类型。
 */
export function classifyError(err: unknown): ErrorType {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()

  if (lower.includes('context_length') || lower.includes('too many tokens') || lower.includes('maximum context')) {
    return 'context_length'
  }
  if (lower.includes('api_key') || lower.includes('api key') || lower.includes('unauthorized') || lower.includes('401') || lower.includes('invalid_api_key')) {
    return 'invalid_api_key'
  }
  if (lower.includes('rate') || lower.includes('429') || lower.includes('too many requests')) {
    return 'rate_limit'
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline')) {
    return 'timeout'
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('network') || lower.includes('fetch failed')) {
    return 'network'
  }
  if (lower.includes('empty') || lower.includes('返回空')) {
    return 'empty_response'
  }

  return 'unknown'
}

/**
 * 获取用户友好的错误消息。
 */
export function getFriendlyMessage(errorType: ErrorType): string {
  return USER_FRIENDLY_MESSAGES[errorType] ?? 'AI 处理异常，请重试'
}

// ────────────────────────────────────────────
// Agent LLM 调用包装器
// ────────────────────────────────────────────

/**
 * 包装 Agent 节点的 LLM 调用，统一错误处理。
 *
 * - 正常情况：返回 fn() 的结果
 * - 异常情况：原始错误写控制台日志，返回用户友好的 AIMessage（不中断图）
 * - 可选降级内容：LLM 失败时返回预设内容（如 summarizer 的任务列表）
 */
export async function callLLMWithFallback<T>(
  agentName: string,
  fn: () => Promise<T>,
  fallbackContent?: string,
): Promise<T | { messages: AIMessage[] }> {
  try {
    // 自动重试：429/5xx 错误重试 2 次，400 不重试
    return await streamWithRetry(agentName, fn, 2)
  } catch (err) {
    const errorType = classifyError(err)
    const friendlyMsg = getFriendlyMessage(errorType)
    const rawMsg = err instanceof Error ? err.message : String(err)

    // 控制台日志：完整错误信息
    console.error(`[${agentName}] LLM 调用失败 [${errorType}]:`)
    console.error(`  原始错误: ${rawMsg}`)
    if (err instanceof Error && err.stack) {
      console.error(`  堆栈: ${err.stack.split('\n').slice(1, 4).join('\n  ')}`)
    }

    // 有降级内容时返回降级结果
    if (fallbackContent !== undefined) {
      return {
        messages: [new AIMessage({ content: fallbackContent })],
      } as T
    }

    // 无降级内容时返回友好错误消息（不中断图）
    return {
      messages: [new AIMessage({
        content: `⚠️ ${friendlyMsg}`,
      })],
    } as T
  }
}

// ────────────────────────────────────────────
// SSE 错误事件发送器
// ────────────────────────────────────────────

export interface SendErrorOptions {
  error: unknown
  agent?: string
  phase?: 'thinking' | 'generating' | 'tool'
}

/**
 * 统一 SSE 错误事件发送。
 *
 * - 原始错误写控制台日志
 * - 前端只收到用户友好的消息
 */
export function createSendError(send: (data: Record<string, unknown>) => void) {
  return function sendError(opts: SendErrorOptions): void {
    const rawMsg = opts.error instanceof Error ? opts.error.message : String(opts.error)
    const errorType = classifyError(opts.error)
    const friendlyMsg = getFriendlyMessage(errorType)

    // 控制台日志
    console.error(`[AI] ${opts.agent ?? 'unknown'} [${opts.phase ?? 'unknown'}] 错误 [${errorType}]:`)
    console.error(`  ${rawMsg}`)

    // 前端：友好消息
    send({
      type: 'error',
      content: friendlyMsg,
      agent: opts.agent ?? 'unknown',
      errorType,
      recoverable: errorType !== 'invalid_api_key',
    })
  }
}
