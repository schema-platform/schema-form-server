/**
 * AI Health Check Routes.
 *
 * GET /api/ai/health — Check AI provider connectivity and API key status
 */

import Router from '@koa/router'
import { llmManager } from './services/llmManager.js'

const router = new Router({ prefix: '/api/ai' })

interface ProviderHealth {
  name: string
  hasApiKey: boolean
  model: string
  isDefault: boolean
}

/**
 * GET /api/ai/health
 *
 * Returns the health status of all configured AI providers.
 * Does NOT expose actual API key values — only whether they are configured.
 */
router.get('/health', async (ctx) => {
  const providerInfos = llmManager.getProviderInfo()
  const defaultProvider = llmManager.defaultProvider

  const providers: ProviderHealth[] = providerInfos.map((p) => ({
    name: p.name,
    hasApiKey: true, // if it's registered, the key was present at startup
    model: p.defaultModel,
    isDefault: p.isDefault,
  }))

  // Also check for env vars that exist but weren't registered (e.g. invalid keys)
  const envKeys: Array<{ name: string; envVar: string }> = [
    { name: 'deepseek', envVar: 'DEEPSEEK_API_KEY' },
    { name: 'openai', envVar: 'OPENAI_API_KEY' },
    { name: 'claude', envVar: 'CLAUDE_API_KEY' },
  ]

  for (const { name, envVar } of envKeys) {
    const registered = providers.some((p) => p.name === name)
    if (!registered && process.env[envVar]) {
      providers.push({
        name,
        hasApiKey: true,
        model: 'unknown',
        isDefault: false,
      })
    }
  }

  const hasAnyProvider = providers.length > 0

  ctx.body = {
    success: true,
    data: {
      status: hasAnyProvider ? 'ok' : 'unconfigured',
      defaultProvider,
      providers,
      hasApiKey: hasAnyProvider,
    },
  }
})

export default router
