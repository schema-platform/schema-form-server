/**
 * LLM Instance Cache — ChatOpenAI singleton per model.
 *
 * Uses LLMManager to resolve the current default provider and create
 * LangChain-compatible model instances via provider.createLangChainModel().
 *
 * Falls back to ModelConfig DB lookup, then to environment variables
 * when LLMManager has no providers registered.
 *
 * Cache key includes provider name to avoid collisions when switching providers.
 *
 * Usage:
 *   import { getLLM } from '../services/llmCache.js'
 *   const model = getLLM()           // default provider from llmManager
 *   const fast = getLLM({ temperature: 0 })  // cached separately
 */

import { ChatOpenAI } from '@langchain/openai'
import { llmManager } from './llmManager.js'
import type { LangChainModelOptions } from './llmProvider.js'

interface LLMOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  /** Enable JSON response format (for structured output). */
  jsonMode?: boolean
}

interface ResolvedConfig {
  providerName: string
  apiKey: string
  baseURL: string
  model: string
  temperature: number
  maxTokens: number
}

const llmCache = new Map<string, ChatOpenAI>()

function cacheKey(providerName: string, opts: LLMOptions, resolved: ResolvedConfig): string {
  const json = opts.jsonMode ? 'json' : 'text'
  return `${providerName}|${resolved.model}|${resolved.temperature}|${resolved.maxTokens}|${json}`
}

/**
 * Resolve the LLM configuration.
 *
 * Priority:
 * 1. LLMManager default provider (registered from env vars)
 * 2. Default ModelConfig from DB (isDefault=true)
 * 3. Environment variable fallback (DEEPSEEK_API_KEY)
 */
async function resolveConfig(opts: LLMOptions): Promise<ResolvedConfig> {
  // Try LLMManager first — it has providers registered from env vars
  try {
    const provider = llmManager.getProvider()
    return {
      providerName: provider.name,
      apiKey: '', // provider handles its own API key internally
      baseURL: '',
      model: opts.model ?? provider.defaultModel,
      temperature: opts.temperature ?? 0.7,
      maxTokens: opts.maxTokens ?? 8192,
    }
  } catch {
    // LLMManager has no providers — fall through to DB/env
  }

  // Fallback to ModelConfig from DB
  const { ModelConfigModel } = await import('../../models/ModelConfig.js')
  const dbConfig = await ModelConfigModel.findOne({ isDefault: true }).lean<{
    provider: string
    apiKey: string
    baseUrl: string
    model: string
    parameters?: { temperature?: number; maxTokens?: number }
  }>()

  if (dbConfig) {
    return {
      providerName: dbConfig.provider,
      apiKey: dbConfig.apiKey || process.env.DEEPSEEK_API_KEY || '',
      baseURL: dbConfig.baseUrl || getDefaultBaseUrl(dbConfig.provider),
      model: opts.model ?? dbConfig.model,
      temperature: opts.temperature ?? dbConfig.parameters?.temperature ?? 0.7,
      maxTokens: opts.maxTokens ?? dbConfig.parameters?.maxTokens ?? 8192,
    }
  }

  // Final fallback to environment variables
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error(
      'No LLM provider registered, no default ModelConfig found, and DEEPSEEK_API_KEY is not set. '
      + 'Register a provider via LLMManager, seed model configs, or set DEEPSEEK_API_KEY.',
    )
  }

  return {
    providerName: 'deepseek',
    apiKey,
    baseURL: 'https://api.deepseek.com',
    model: opts.model ?? 'deepseek-v4-pro',
    temperature: opts.temperature ?? 0.7,
    maxTokens: opts.maxTokens ?? 8192,
  }
}

function getDefaultBaseUrl(provider: string): string {
  const baseUrls: Record<string, string> = {
    deepseek: 'https://api.deepseek.com',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    ollama: 'http://localhost:11434/v1',
  }
  return baseUrls[provider] ?? 'https://api.deepseek.com'
}

/**
 * Get or create a cached ChatOpenAI instance.
 *
 * When LLMManager has a registered provider, uses provider.createLangChainModel()
 * for a proper LangChain-compatible instance. Otherwise falls back to direct
 * ChatOpenAI construction from DB/env config.
 *
 * Cache key includes provider name to avoid collisions when switching providers.
 */
export async function getLLM(opts: LLMOptions = {}): Promise<ChatOpenAI> {
  const resolved = await resolveConfig(opts)
  const key = cacheKey(resolved.providerName, opts, resolved)

  if (!llmCache.has(key)) {
    // Try to use LLMManager provider's createLangChainModel
    try {
      const provider = llmManager.getProvider(resolved.providerName)
      const langChainOpts: LangChainModelOptions = {
        model: resolved.model,
        temperature: resolved.temperature,
        maxTokens: resolved.maxTokens,
        streaming: true,
      }
      // temperature=0 时不启用 jsonMode（兼容性：低温 + json_object 可能不稳定）
      if (opts.jsonMode && resolved.temperature > 0) {
        langChainOpts.responseFormat = { type: 'json_object' }
      }
      const model = provider.createLangChainModel(langChainOpts) as ChatOpenAI
      llmCache.set(key, model)
    } catch {
      // Provider not found in LLMManager — construct ChatOpenAI directly
      if (!resolved.apiKey) {
        throw new Error('API key is required. Set a default ModelConfig or DEEPSEEK_API_KEY environment variable.')
      }

      const effectiveJsonMode = opts.jsonMode && resolved.temperature > 0

      const model = new ChatOpenAI({
        model: resolved.model,
        apiKey: resolved.apiKey,
        configuration: { baseURL: resolved.baseURL },
        temperature: resolved.temperature,
        maxTokens: resolved.maxTokens,
        streaming: true,
        timeout: 120_000,
        ...(effectiveJsonMode ? { modelKwargs: { response_format: { type: 'json_object' } } } : {}),
      })

      llmCache.set(key, model)
    }
  }

  return llmCache.get(key)!
}

/**
 * Clear the LLM cache. Useful for testing or config changes.
 */
export function clearLLMCache(): void {
  llmCache.clear()
}

/**
 * Get the current LLM provider info from LLMManager.
 * Falls back to null if no providers are registered.
 */
export function getCurrentProvider(): { name: string; defaultModel: string } | null {
  try {
    const provider = llmManager.getProvider()
    return { name: provider.name, defaultModel: provider.defaultModel }
  } catch {
    return null
  }
}
