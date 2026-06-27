/**
 * LLM Manager — Provider registry, routing, and runtime switching.
 *
 * Manages multiple LLM providers and allows runtime switching
 * of the default provider. Providers are registered on startup
 * based on available API keys.
 *
 * Integrates LLMRouter for strategy-based provider selection
 * and aggregates usage statistics across all providers.
 */

import type { LLMProvider, ProviderConfig, RoutingStrategyName, UsageStats, LLMRequest } from './llmProvider.js'
import { DeepSeekProvider } from './deepseekProvider.js'
import { OpenAIProvider } from './openaiProvider.js'
import { ClaudeProvider } from './claudeProvider.js'
import { LLMRouter } from './llmRouter.js'

export class LLMManager {
  private providers = new Map<string, LLMProvider>()
  private _defaultProvider: string
  private router: LLMRouter
  private _defaultStrategy: RoutingStrategyName | undefined

  constructor() {
    this.router = new LLMRouter()

    // Register providers based on available API keys
    this.registerFromEnv()

    // Set default from environment or fallback to first available
    this._defaultProvider = process.env.DEFAULT_LLM || 'deepseek'
    this._defaultStrategy = process.env.DEFAULT_LLM_STRATEGY as RoutingStrategyName | undefined
  }

  /**
   * Register providers from environment variables.
   */
  private registerFromEnv(): void {
    // DeepSeek
    const deepseekKey = process.env.DEEPSEEK_API_KEY
    if (deepseekKey) {
      this.providers.set('deepseek', new DeepSeekProvider({
        apiKey: deepseekKey,
        baseURL: process.env.DEEPSEEK_BASE_URL,
        defaultModel: process.env.DEEPSEEK_MODEL,
      }))
    }

    // OpenAI
    const openaiKey = process.env.OPENAI_API_KEY
    if (openaiKey) {
      this.providers.set('openai', new OpenAIProvider({
        apiKey: openaiKey,
        baseURL: process.env.OPENAI_BASE_URL,
        defaultModel: process.env.OPENAI_MODEL,
      }))
    }

    // Claude (Anthropic)
    const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY
    if (claudeKey) {
      this.providers.set('claude', new ClaudeProvider({
        apiKey: claudeKey,
        baseURL: process.env.CLAUDE_BASE_URL || process.env.ANTHROPIC_BASE_URL,
        defaultModel: process.env.CLAUDE_MODEL,
      }))
    }
  }

  /**
   * Register a provider programmatically.
   */
  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.name, provider)
  }

  /**
   * Get a provider by name, or the default provider.
   */
  getProvider(name?: string): LLMProvider {
    const providerName = name || this._defaultProvider
    const provider = this.providers.get(providerName)

    if (!provider) {
      const available = Array.from(this.providers.keys()).join(', ')
      throw new Error(
        `LLM provider "${providerName}" not found. Available: ${available || 'none'}`
      )
    }

    return provider
  }

  /**
   * Route a request to the optimal provider based on strategy.
   * If a specific provider is requested, use it directly.
   * Otherwise, use the routing strategy (or default provider if no strategy).
   */
  routeRequest(request: LLMRequest): LLMProvider {
    return this.router.route(request, this.providers, this._defaultProvider)
  }

  /**
   * Get the default provider name.
   */
  get defaultProvider(): string {
    return this._defaultProvider
  }

  /**
   * Get the default routing strategy.
   */
  get defaultStrategy(): RoutingStrategyName | undefined {
    return this._defaultStrategy
  }

  /**
   * Set the default provider.
   */
  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Cannot set default: provider "${name}" not registered`)
    }
    this._defaultProvider = name
  }

  /**
   * Set the default routing strategy.
   */
  setDefaultStrategy(strategy: RoutingStrategyName | undefined): void {
    this._defaultStrategy = strategy
  }

  /**
   * List all registered provider names.
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys())
  }

  /**
   * List available routing strategies.
   */
  listStrategies(): RoutingStrategyName[] {
    return this.router.listStrategies()
  }

  /**
   * Get provider info for API response.
   */
  getProviderInfo(): Array<{
    name: string
    models: string[]
    defaultModel: string
    isDefault: boolean
    qualityScore: number
    speedScore: number
    costPer1kPromptTokens: number
    costPer1kCompletionTokens: number
  }> {
    return Array.from(this.providers.values()).map((p) => ({
      name: p.name,
      models: p.models,
      defaultModel: p.defaultModel,
      isDefault: p.name === this._defaultProvider,
      qualityScore: p.qualityScore,
      speedScore: p.speedScore,
      costPer1kPromptTokens: p.costPer1kPromptTokens,
      costPer1kCompletionTokens: p.costPer1kCompletionTokens,
    }))
  }

  /**
   * Get aggregated usage statistics across all providers.
   */
  getAggregatedUsage(): {
    total: UsageStats
    byProvider: Array<{ name: string; usage: UsageStats }>
  } {
    const byProvider: Array<{ name: string; usage: UsageStats }> = []
    const total: UsageStats = {
      totalTokens: 0,
      totalCost: 0,
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
    }

    for (const [name, provider] of this.providers) {
      const usage = provider.getUsage()
      byProvider.push({ name, usage })
      total.totalTokens += usage.totalTokens
      total.totalCost += usage.totalCost
      total.requestCount += usage.requestCount
      total.promptTokens += usage.promptTokens
      total.completionTokens += usage.completionTokens
    }

    return { total, byProvider }
  }

  /**
   * Get usage for a specific provider.
   */
  getProviderUsage(name: string): UsageStats {
    const provider = this.providers.get(name)
    if (!provider) {
      throw new Error(`LLM provider "${name}" not found`)
    }
    return provider.getUsage()
  }
}

// ────────────────────────────────────────────
// Singleton instance
// ────────────────────────────────────────────

export const llmManager = new LLMManager()
