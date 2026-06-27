/**
 * LLM Provider abstraction layer.
 *
 * Defines a common interface for different LLM providers (DeepSeek, OpenAI, Claude, etc.)
 * enabling runtime switching between providers without changing agent code.
 */

import type OpenAI from 'openai'

// ────────────────────────────────────────────
// Core types
// ────────────────────────────────────────────

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[]
  responseFormat?: { type: 'json_object' | 'text' }
  streaming?: boolean
}

export interface ChatResponse {
  content: string
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
  usage: {
    prompt: number
    completion: number
    total: number
  }
}

export interface Chunk {
  content?: string
  reasoningContent?: string
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall[]
}

// ────────────────────────────────────────────
// Usage tracking
// ────────────────────────────────────────────

export interface UsageStats {
  totalTokens: number
  totalCost: number
  requestCount: number
  promptTokens: number
  completionTokens: number
}

// ────────────────────────────────────────────
// Routing strategy types
// ────────────────────────────────────────────

export type RoutingStrategyName = 'cost' | 'quality' | 'speed'

export interface LLMRequest {
  messages: Message[]
  options?: ChatOptions
  strategy?: RoutingStrategyName
}

// ────────────────────────────────────────────
// Provider interface
// ────────────────────────────────────────────

export interface LLMProvider {
  /** Provider name (e.g., 'deepseek', 'openai', 'claude') */
  readonly name: string

  /** Available models for this provider */
  readonly models: string[]

  /** Default model to use when none specified */
  readonly defaultModel: string

  /** Cost per 1K tokens (prompt) in USD — used for cost-based routing */
  readonly costPer1kPromptTokens: number

  /** Cost per 1K tokens (completion) in USD — used for cost-based routing */
  readonly costPer1kCompletionTokens: number

  /** Quality score 0-100 — used for quality-based routing */
  readonly qualityScore: number

  /** Speed score 0-100 — used for speed-based routing */
  readonly speedScore: number

  /**
   * Non-streaming chat completion.
   */
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>

  /**
   * Streaming chat completion.
   * Returns an async iterable of chunks.
   */
  stream(messages: Message[], options?: ChatOptions): AsyncIterable<Chunk>

  /**
   * Create a LangChain-compatible model instance.
   * Used by LangGraph agents that need the LangChain interface.
   */
  createLangChainModel(options?: LangChainModelOptions): unknown

  /**
   * Get cumulative usage statistics for this provider.
   */
  getUsage(): UsageStats
}

export interface LangChainModelOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  streaming?: boolean
  responseFormat?: { type: 'json_object' | 'text' }
}

// ────────────────────────────────────────────
// Provider configuration
// ────────────────────────────────────────────

export interface ProviderConfig {
  apiKey: string
  baseURL?: string
  defaultModel?: string
}
