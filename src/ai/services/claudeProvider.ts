/**
 * Claude LLM Provider.
 *
 * Implements the LLMProvider interface for Anthropic's Claude API.
 * Uses direct HTTP calls (Anthropic's API is not OpenAI-compatible).
 * LangChain integration requires @langchain/anthropic — falls back to error if not installed.
 */

import type OpenAI from 'openai'
import type {
  LLMProvider,
  Message,
  ChatOptions,
  ChatResponse,
  Chunk,
  ProviderConfig,
  LangChainModelOptions,
  UsageStats,
} from './llmProvider.js'

// ────────────────────────────────────────────
// Anthropic API types
// ────────────────────────────────────────────

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: AnthropicContentBlock[]
  model: string
  stop_reason: string
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

interface AnthropicStreamEvent {
  type: string
  delta?: { type: string; text?: string }
  message?: AnthropicResponse
  usage?: { input_tokens: number; output_tokens: number }
}

// ────────────────────────────────────────────
// Provider config for Claude
// ────────────────────────────────────────────

export interface ClaudeProviderConfig extends ProviderConfig {
  /** Anthropic API version header */
  apiVersion?: string
}

// ────────────────────────────────────────────
// ClaudeProvider implementation
// ────────────────────────────────────────────

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude'
  readonly models = [
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ]
  readonly defaultModel = 'claude-sonnet-4-20250514'
  readonly costPer1kPromptTokens = 0.003
  readonly costPer1kCompletionTokens = 0.015
  readonly qualityScore = 95
  readonly speedScore = 70

  private apiKey: string
  private baseURL: string
  private apiVersion: string
  private usage: UsageStats = {
    totalTokens: 0,
    totalCost: 0,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
  }

  constructor(config: ClaudeProviderConfig) {
    this.apiKey = config.apiKey
    this.baseURL = config.baseURL || 'https://api.anthropic.com'
    this.apiVersion = config.apiVersion || '2023-06-01'
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const { system, anthropicMessages } = this.convertMessages(messages)
    const model = options?.model || this.defaultModel

    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens || 4096,
      messages: anthropicMessages,
    }

    if (system) {
      body.system = system
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }

    const response = await fetch(`${this.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Claude API error (${response.status}): ${errorBody}`)
    }

    const data = (await response.json()) as AnthropicResponse
    const contentBlock = data.content.find((b) => b.type === 'text')
    const toolUseBlocks = data.content.filter((b) => b.type === 'tool_use')

    const promptTokens = data.usage.input_tokens
    const completionTokens = data.usage.output_tokens
    const totalTokens = promptTokens + completionTokens

    this.trackUsage(promptTokens, completionTokens, totalTokens)

    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined =
      toolUseBlocks.length > 0
        ? toolUseBlocks.map((b) => ({
            id: b.id!,
            type: 'function' as const,
            function: {
              name: b.name!,
              arguments: JSON.stringify(b.input || {}),
            },
          }))
        : undefined

    return {
      content: contentBlock?.text || '',
      toolCalls,
      usage: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens,
      },
    }
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<Chunk> {
    const { system, anthropicMessages } = this.convertMessages(messages)
    const model = options?.model || this.defaultModel

    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens || 4096,
      messages: anthropicMessages,
      stream: true,
    }

    if (system) {
      body.system = system
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }

    const response = await fetch(`${this.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Claude API error (${response.status}): ${errorBody}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body from Claude streaming API')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') return

          try {
            const event = JSON.parse(data) as AnthropicStreamEvent

            if (event.type === 'content_block_delta' && event.delta?.text) {
              yield { content: event.delta.text }
            }

            if (event.type === 'message_delta' && event.usage) {
              this.trackUsage(
                0,
                event.usage.output_tokens,
                event.usage.output_tokens,
              )
            }

            if (event.type === 'message_start' && event.message?.usage) {
              this.trackUsage(
                event.message.usage.input_tokens,
                0,
                event.message.usage.input_tokens,
              )
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  createLangChainModel(_options?: LangChainModelOptions): unknown {
    // Claude's LangChain integration requires @langchain/anthropic.
    // If available, use it; otherwise throw a descriptive error.
    try {
      // Dynamic import to avoid hard dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@langchain/anthropic')
      const ChatAnthropic = mod.ChatAnthropic
      return new ChatAnthropic({
        model: _options?.model || this.defaultModel,
        apiKey: this.apiKey,
        anthropicApiUrl: this.baseURL,
        temperature: _options?.temperature ?? 0.7,
        maxTokens: _options?.maxTokens || 4096,
      })
    } catch {
      throw new Error(
        'Claude LangChain integration requires @langchain/anthropic. ' +
        'Install it with: pnpm add @langchain/anthropic'
      )
    }
  }

  getUsage(): UsageStats {
    return { ...this.usage }
  }

  // ────────────────────────────────────────────
  // Message format conversion
  // ────────────────────────────────────────────

  /**
   * Convert OpenAI-format messages to Anthropic format.
   * Extracts system message separately (Anthropic requires it as a top-level field).
   */
  private convertMessages(messages: Message[]): {
    system: string | undefined
    anthropicMessages: AnthropicMessage[]
  } {
    let system: string | undefined
    const anthropicMessages: AnthropicMessage[] = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        continue
      }

      if (msg.role === 'user') {
        anthropicMessages.push({
          role: 'user',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        })
        continue
      }

      if (msg.role === 'assistant') {
        anthropicMessages.push({
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        })
        continue
      }

      // tool messages are handled differently in Anthropic API
      if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: (msg as unknown as Record<string, unknown>).tool_call_id as string,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            },
          ],
        })
      }
    }

    return { system, anthropicMessages }
  }

  private trackUsage(promptTokens: number, completionTokens: number, totalTokens: number): void {
    this.usage.promptTokens += promptTokens
    this.usage.completionTokens += completionTokens
    this.usage.totalTokens += totalTokens
    this.usage.requestCount += 1
    this.usage.totalCost +=
      (promptTokens / 1000) * this.costPer1kPromptTokens +
      (completionTokens / 1000) * this.costPer1kCompletionTokens
  }
}
