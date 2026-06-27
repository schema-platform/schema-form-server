/**
 * LLM Router — Strategy-based provider selection.
 *
 * Routes LLM requests to the optimal provider based on the selected strategy:
 * - cost:    Select the provider with the lowest estimated cost
 * - quality: Select the provider with the highest quality score
 * - speed:   Select the provider with the highest speed score
 *
 * Falls back to the default provider when no strategy is specified.
 */

import type {
  LLMProvider,
  LLMRequest,
  RoutingStrategyName,
  UsageStats,
  Message,
  ChatOptions,
  ChatResponse,
  Chunk,
} from './llmProvider.js'

// ────────────────────────────────────────────
// Routing strategy interface
// ────────────────────────────────────────────

export interface RoutingStrategy {
  readonly name: RoutingStrategyName
  selectProvider(request: LLMRequest, providers: Map<string, LLMProvider>): LLMProvider
}

// ────────────────────────────────────────────
// Strategy implementations
// ────────────────────────────────────────────

/**
 * Cost-optimized strategy — selects the provider with the lowest estimated cost.
 * Estimates cost based on message token count (rough: 1 token ~ 4 chars).
 */
export class CostOptimizedStrategy implements RoutingStrategy {
  readonly name = 'cost' as const

  selectProvider(request: LLMRequest, providers: Map<string, LLMProvider>): LLMProvider {
    let minCost = Infinity
    let selected: LLMProvider | null = null

    const estimatedInputTokens = this.estimateTokens(request.messages)

    for (const provider of providers.values()) {
      const cost =
        (estimatedInputTokens / 1000) * provider.costPer1kPromptTokens +
        ((request.options?.maxTokens ?? 4096) / 1000) * provider.costPer1kCompletionTokens

      if (cost < minCost) {
        minCost = cost
        selected = provider
      }
    }

    if (!selected) {
      throw new Error('No LLM providers available for cost-based routing')
    }

    return selected
  }

  private estimateTokens(messages: Message[]): number {
    let totalChars = 0
    for (const msg of messages) {
      totalChars += typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length
    }
    return Math.ceil(totalChars / 4)
  }
}

/**
 * Quality-optimized strategy — selects the provider with the highest quality score.
 */
export class QualityOptimizedStrategy implements RoutingStrategy {
  readonly name = 'quality' as const

  selectProvider(_request: LLMRequest, providers: Map<string, LLMProvider>): LLMProvider {
    let bestScore = -1
    let selected: LLMProvider | null = null

    for (const provider of providers.values()) {
      if (provider.qualityScore > bestScore) {
        bestScore = provider.qualityScore
        selected = provider
      }
    }

    if (!selected) {
      throw new Error('No LLM providers available for quality-based routing')
    }

    return selected
  }
}

/**
 * Speed-optimized strategy — selects the provider with the highest speed score.
 */
export class SpeedOptimizedStrategy implements RoutingStrategy {
  readonly name = 'speed' as const

  selectProvider(_request: LLMRequest, providers: Map<string, LLMProvider>): LLMProvider {
    let bestSpeed = -1
    let selected: LLMProvider | null = null

    for (const provider of providers.values()) {
      if (provider.speedScore > bestSpeed) {
        bestSpeed = provider.speedScore
        selected = provider
      }
    }

    if (!selected) {
      throw new Error('No LLM providers available for speed-based routing')
    }

    return selected
  }
}

// ────────────────────────────────────────────
// LLM Router
// ────────────────────────────────────────────

export class LLMRouter {
  private strategies = new Map<RoutingStrategyName, RoutingStrategy>()

  constructor() {
    this.strategies.set('cost', new CostOptimizedStrategy())
    this.strategies.set('quality', new QualityOptimizedStrategy())
    this.strategies.set('speed', new SpeedOptimizedStrategy())
  }

  /**
   * Select the best provider based on the routing strategy.
   * Falls back to the default provider when no strategy is specified.
   */
  route(request: LLMRequest, providers: Map<string, LLMProvider>, defaultProvider: string): LLMProvider {
    const strategyName = request.strategy

    if (!strategyName) {
      const provider = providers.get(defaultProvider)
      if (!provider) {
        throw new Error(`Default LLM provider "${defaultProvider}" not found`)
      }
      return provider
    }

    const strategy = this.strategies.get(strategyName)
    if (!strategy) {
      throw new Error(`Unknown routing strategy: ${strategyName}`)
    }

    return strategy.selectProvider(request, providers)
  }

  /**
   * List available strategy names.
   */
  listStrategies(): RoutingStrategyName[] {
    return Array.from(this.strategies.keys())
  }
}
