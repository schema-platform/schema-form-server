/**
 * Tests for LLM Provider system — Provider interface, Router, and Manager.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LLMProvider, Message, ChatOptions, ChatResponse, Chunk, ProviderConfig, LangChainModelOptions, UsageStats } from '../services/llmProvider.js'
import { CostOptimizedStrategy, QualityOptimizedStrategy, SpeedOptimizedStrategy, LLMRouter } from '../services/llmRouter.js'

// ────────────────────────────────────────────
// Mock provider for testing
// ────────────────────────────────────────────

class MockProvider implements LLMProvider {
  readonly name: string
  readonly models: string[]
  readonly defaultModel: string
  readonly costPer1kPromptTokens: number
  readonly costPer1kCompletionTokens: number
  readonly qualityScore: number
  readonly speedScore: number

  private usage: UsageStats = {
    totalTokens: 0,
    totalCost: 0,
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
  }

  constructor(
    name: string,
    opts: {
      costPer1kPromptTokens?: number
      costPer1kCompletionTokens?: number
      qualityScore?: number
      speedScore?: number
    } = {},
  ) {
    this.name = name
    this.models = [`${name}-model-1`, `${name}-model-2`]
    this.defaultModel = `${name}-model-1`
    this.costPer1kPromptTokens = opts.costPer1kPromptTokens ?? 0.001
    this.costPer1kCompletionTokens = opts.costPer1kCompletionTokens ?? 0.002
    this.qualityScore = opts.qualityScore ?? 80
    this.speedScore = opts.speedScore ?? 80
  }

  async chat(messages: Message[], _options?: ChatOptions): Promise<ChatResponse> {
    this.usage.requestCount += 1
    this.usage.promptTokens += 100
    this.usage.completionTokens += 200
    this.usage.totalTokens += 300
    this.usage.totalCost += 0.001
    return {
      content: `Response from ${this.name}`,
      usage: { prompt: 100, completion: 200, total: 300 },
    }
  }

  async *_stream(_messages: Message[], _options?: ChatOptions): AsyncIterable<Chunk> {
    yield { content: 'chunk1' }
    yield { content: 'chunk2' }
  }

  stream = this._stream.bind(this)

  createLangChainModel(_options?: LangChainModelOptions): unknown {
    return { model: this.name }
  }

  getUsage(): UsageStats {
    return { ...this.usage }
  }
}

// ────────────────────────────────────────────
// LLMRouter tests
// ────────────────────────────────────────────

describe('LLMRouter', () => {
  let router: LLMRouter
  let providers: Map<string, LLMProvider>

  beforeEach(() => {
    router = new LLMRouter()
    providers = new Map<string, LLMProvider>()
  })

  it('should list available strategies', () => {
    const strategies = router.listStrategies()
    expect(strategies).toContain('cost')
    expect(strategies).toContain('quality')
    expect(strategies).toContain('speed')
  })

  it('should fall back to default provider when no strategy specified', () => {
    const cheap = new MockProvider('cheap')
    const expensive = new MockProvider('expensive')
    providers.set('cheap', cheap)
    providers.set('expensive', expensive)

    const request = { messages: [{ role: 'user', content: 'hello' }] }
    const selected = router.route(request, providers, 'cheap')
    expect(selected.name).toBe('cheap')
  })

  it('should throw when default provider not found', () => {
    const request = { messages: [{ role: 'user', content: 'hello' }] }
    expect(() => router.route(request, providers, 'nonexistent')).toThrow(
      'Default LLM provider "nonexistent" not found',
    )
  })
})

// ────────────────────────────────────────────
// CostOptimizedStrategy tests
// ────────────────────────────────────────────

describe('CostOptimizedStrategy', () => {
  it('should select the cheapest provider', () => {
    const strategy = new CostOptimizedStrategy()
    const providers = new Map<string, LLMProvider>()
    providers.set('expensive', new MockProvider('expensive', { costPer1kPromptTokens: 0.01, costPer1kCompletionTokens: 0.03 }))
    providers.set('cheap', new MockProvider('cheap', { costPer1kPromptTokens: 0.0001, costPer1kCompletionTokens: 0.0002 }))
    providers.set('mid', new MockProvider('mid', { costPer1kPromptTokens: 0.001, costPer1kCompletionTokens: 0.002 }))

    const request = { messages: [{ role: 'user', content: 'hello' }] }
    const selected = strategy.selectProvider(request, providers)
    expect(selected.name).toBe('cheap')
  })

  it('should throw when no providers available', () => {
    const strategy = new CostOptimizedStrategy()
    const providers = new Map<string, LLMProvider>()
    const request = { messages: [{ role: 'user', content: 'hello' }] }
    expect(() => strategy.selectProvider(request, providers)).toThrow('No LLM providers available')
  })
})

// ────────────────────────────────────────────
// QualityOptimizedStrategy tests
// ────────────────────────────────────────────

describe('QualityOptimizedStrategy', () => {
  it('should select the highest quality provider', () => {
    const strategy = new QualityOptimizedStrategy()
    const providers = new Map<string, LLMProvider>()
    providers.set('fast', new MockProvider('fast', { qualityScore: 70, speedScore: 95 }))
    providers.set('best', new MockProvider('best', { qualityScore: 98, speedScore: 60 }))
    providers.set('balanced', new MockProvider('balanced', { qualityScore: 85, speedScore: 80 }))

    const request = { messages: [{ role: 'user', content: 'hello' }] }
    const selected = strategy.selectProvider(request, providers)
    expect(selected.name).toBe('best')
  })
})

// ────────────────────────────────────────────
// SpeedOptimizedStrategy tests
// ────────────────────────────────────────────

describe('SpeedOptimizedStrategy', () => {
  it('should select the fastest provider', () => {
    const strategy = new SpeedOptimizedStrategy()
    const providers = new Map<string, LLMProvider>()
    providers.set('slow', new MockProvider('slow', { qualityScore: 95, speedScore: 50 }))
    providers.set('fast', new MockProvider('fast', { qualityScore: 75, speedScore: 98 }))
    providers.set('balanced', new MockProvider('balanced', { qualityScore: 85, speedScore: 80 }))

    const request = { messages: [{ role: 'user', content: 'hello' }] }
    const selected = strategy.selectProvider(request, providers)
    expect(selected.name).toBe('fast')
  })
})

// ────────────────────────────────────────────
// Provider usage tracking tests
// ────────────────────────────────────────────

describe('Provider usage tracking', () => {
  it('should track usage after chat calls', async () => {
    const provider = new MockProvider('test')

    const initialUsage = provider.getUsage()
    expect(initialUsage.requestCount).toBe(0)
    expect(initialUsage.totalTokens).toBe(0)

    await provider.chat([{ role: 'user', content: 'hello' }])

    const afterUsage = provider.getUsage()
    expect(afterUsage.requestCount).toBe(1)
    expect(afterUsage.promptTokens).toBe(100)
    expect(afterUsage.completionTokens).toBe(200)
    expect(afterUsage.totalTokens).toBe(300)
  })

  it('should accumulate usage across multiple calls', async () => {
    const provider = new MockProvider('test')

    await provider.chat([{ role: 'user', content: 'hello' }])
    await provider.chat([{ role: 'user', content: 'world' }])

    const usage = provider.getUsage()
    expect(usage.requestCount).toBe(2)
    expect(usage.totalTokens).toBe(600)
  })

  it('should return a copy of usage stats', async () => {
    const provider = new MockProvider('test')
    await provider.chat([{ role: 'user', content: 'hello' }])

    const usage1 = provider.getUsage()
    const usage2 = provider.getUsage()

    // Should be equal but not the same reference
    expect(usage1).toEqual(usage2)
    expect(usage1).not.toBe(usage2)
  })
})

// ────────────────────────────────────────────
// Routing with strategy integration tests
// ────────────────────────────────────────────

describe('LLMRouter strategy integration', () => {
  it('should route with cost strategy', () => {
    const router = new LLMRouter()
    const providers = new Map<string, LLMProvider>()
    providers.set('claude', new MockProvider('claude', { costPer1kPromptTokens: 0.003, qualityScore: 95, speedScore: 70 }))
    providers.set('deepseek', new MockProvider('deepseek', { costPer1kPromptTokens: 0.0002, qualityScore: 85, speedScore: 90 }))
    providers.set('openai', new MockProvider('openai', { costPer1kPromptTokens: 0.0025, qualityScore: 92, speedScore: 75 }))

    const request = { messages: [{ role: 'user', content: 'hello' }], strategy: 'cost' as const }
    const selected = router.route(request, providers, 'deepseek')
    expect(selected.name).toBe('deepseek')
  })

  it('should route with quality strategy', () => {
    const router = new LLMRouter()
    const providers = new Map<string, LLMProvider>()
    providers.set('claude', new MockProvider('claude', { costPer1kPromptTokens: 0.003, qualityScore: 95, speedScore: 70 }))
    providers.set('deepseek', new MockProvider('deepseek', { costPer1kPromptTokens: 0.0002, qualityScore: 85, speedScore: 90 }))
    providers.set('openai', new MockProvider('openai', { costPer1kPromptTokens: 0.0025, qualityScore: 92, speedScore: 75 }))

    const request = { messages: [{ role: 'user', content: 'hello' }], strategy: 'quality' as const }
    const selected = router.route(request, providers, 'deepseek')
    expect(selected.name).toBe('claude')
  })

  it('should route with speed strategy', () => {
    const router = new LLMRouter()
    const providers = new Map<string, LLMProvider>()
    providers.set('claude', new MockProvider('claude', { costPer1kPromptTokens: 0.003, qualityScore: 95, speedScore: 70 }))
    providers.set('deepseek', new MockProvider('deepseek', { costPer1kPromptTokens: 0.0002, qualityScore: 85, speedScore: 90 }))
    providers.set('openai', new MockProvider('openai', { costPer1kPromptTokens: 0.0025, qualityScore: 92, speedScore: 75 }))

    const request = { messages: [{ role: 'user', content: 'hello' }], strategy: 'speed' as const }
    const selected = router.route(request, providers, 'deepseek')
    expect(selected.name).toBe('deepseek')
  })

  it('should throw for unknown strategy', () => {
    const router = new LLMRouter()
    const providers = new Map<string, LLMProvider>()
    providers.set('test', new MockProvider('test'))

    const request = { messages: [{ role: 'user', content: 'hello' }], strategy: 'unknown' as never }
    expect(() => router.route(request, providers, 'test')).toThrow('Unknown routing strategy: unknown')
  })
})
