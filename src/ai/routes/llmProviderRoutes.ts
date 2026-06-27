/**
 * LLM Provider API routes.
 *
 * GET  /api/ai/llm-providers   — Get all registered provider info
 * POST /api/ai/llm-provider    — Set default provider
 * GET  /api/ai/llm-usage       — Get usage statistics
 */

import Router from '@koa/router'
import { authMiddleware } from '../../middleware/auth.js'
import { llmManager } from '../services/llmManager.js'
import { clearLLMCache } from '../services/llmCache.js'

const router = new Router({ prefix: '/api/ai' })

// All LLM provider routes require authentication
router.use(authMiddleware())

// ────────────────────────────────────────────
// GET /api/ai/llm-providers
// List all registered providers with their info
// ────────────────────────────────────────────

router.get('/llm-providers', async (ctx) => {
  const providers = llmManager.getProviderInfo()
  const strategies = llmManager.listStrategies()

  ctx.body = {
    success: true,
    data: {
      providers,
      defaultProvider: llmManager.defaultProvider,
      defaultStrategy: llmManager.defaultStrategy ?? null,
      availableStrategies: strategies,
    },
  }
})

// ────────────────────────────────────────────
// POST /api/ai/llm-provider
// Set the default provider (and optionally strategy)
// ────────────────────────────────────────────

router.post('/llm-provider', async (ctx) => {
  const { provider, strategy } = ctx.request.body as {
    provider?: string
    strategy?: string
  }

  if (!provider && !strategy) {
    ctx.status = 400
    ctx.body = {
      success: false,
      error: { message: 'At least one of "provider" or "strategy" is required.' },
    }
    return
  }

  if (provider) {
    try {
      llmManager.setDefaultProvider(provider)
    } catch (err) {
      ctx.status = 400
      ctx.body = {
        success: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      }
      return
    }
  }

  if (strategy !== undefined) {
    const validStrategies = llmManager.listStrategies()
    if (strategy !== '' && !validStrategies.includes(strategy as 'cost' | 'quality' | 'speed')) {
      ctx.status = 400
      ctx.body = {
        success: false,
        error: { message: `Invalid strategy: ${strategy}. Must be one of: ${validStrategies.join(', ')}` },
      }
      return
    }
    llmManager.setDefaultStrategy(strategy === '' ? undefined : strategy as 'cost' | 'quality' | 'speed')
  }

  // Clear LLM cache so new requests use the updated provider/strategy
  clearLLMCache()

  ctx.body = {
    success: true,
    data: {
      defaultProvider: llmManager.defaultProvider,
      defaultStrategy: llmManager.defaultStrategy ?? null,
    },
  }
})

// ────────────────────────────────────────────
// GET /api/ai/llm-usage
// Get aggregated usage statistics
// ────────────────────────────────────────────

router.get('/llm-usage', async (ctx) => {
  const { provider: providerName } = ctx.query as { provider?: string }

  if (providerName) {
    try {
      const usage = llmManager.getProviderUsage(providerName)
      ctx.body = {
        success: true,
        data: {
          provider: providerName,
          usage,
        },
      }
    } catch (err) {
      ctx.status = 404
      ctx.body = {
        success: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      }
    }
    return
  }

  const aggregated = llmManager.getAggregatedUsage()

  ctx.body = {
    success: true,
    data: {
      total: aggregated.total,
      byProvider: aggregated.byProvider,
    },
  }
})

export default router
