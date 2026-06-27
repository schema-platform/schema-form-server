import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { ModelConfigModel } from '../models/ModelConfig.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createModelConfigSchema, updateModelConfigSchema, testModelConfigSchema } from '../schemas/modelConfigSchemas.js'
import { clearLLMCache } from '../ai/services/llmCache.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/model-configs' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ────────────────────────────────────────────
// GET /api/model-configs
// List model configurations
// ────────────────────────────────────────────
router.get('/', requireAuth, async (ctx) => {
  const { search, provider, page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query
  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (search) filter.name = { $regex: escapeRegex(search as string), $options: 'i' }
  if (provider && ['deepseek', 'openai', 'anthropic', 'ollama'].includes(provider as string)) {
    filter.provider = provider
  }

  const [items, total] = await Promise.all([
    ModelConfigModel.find(filter).skip(skip).limit(pageSize).sort({ updatedAt: -1 }),
    ModelConfigModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// ────────────────────────────────────────────
// POST /api/model-configs
// Create a new model configuration
// ────────────────────────────────────────────
router.post('/', requireAuth, requirePermission('model_config:create'), validate(createModelConfigSchema), async (ctx) => {
  const { name, provider, model, apiKey, baseUrl, parameters, isDefault } = ctx.request.body as {
    name: string
    provider: string
    model: string
    apiKey?: string
    baseUrl?: string
    parameters?: Record<string, number>
    isDefault?: boolean
  }

  // If isDefault, unset other defaults for the same provider
  if (isDefault) {
    await ModelConfigModel.updateMany(
      { provider, isDefault: true },
      { $set: { isDefault: false } },
    )
  }

  const config = await ModelConfigModel.create({
    _id: uuidv4(),
    name: name.trim(),
    provider,
    model: model.trim(),
    apiKey: apiKey ?? '',
    baseUrl: baseUrl ?? '',
    parameters: parameters ?? {},
    isDefault: isDefault ?? false,
  })

  clearLLMCache()

  ctx.status = 201
  ctx.body = { success: true, data: config }
})

// ────────────────────────────────────────────
// GET /api/model-configs/:id
// Get model configuration detail
// ────────────────────────────────────────────
router.get('/:id', requireAuth, async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const config = await ModelConfigModel.findById(id)

  if (!config) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Model config not found.' } }
    return
  }

  ctx.body = { success: true, data: config }
})

// ────────────────────────────────────────────
// PUT /api/model-configs/:id
// Update model configuration
// ────────────────────────────────────────────
router.put('/:id', requireAuth, requirePermission('model_config:edit'), validate(updateModelConfigSchema), async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as Record<string, unknown>

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await ModelConfigModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Model config not found.' } }
    return
  }

  // If setting isDefault, unset other defaults for the same provider
  const targetProvider = (body.provider as string) ?? existing.provider
  if (body.isDefault === true) {
    await ModelConfigModel.updateMany(
      { provider: targetProvider, isDefault: true, _id: { $ne: id } },
      { $set: { isDefault: false } },
    )
  }

  const update: Record<string, unknown> = {}
  if (body.name !== undefined) update.name = (body.name as string).trim()
  if (body.provider !== undefined) update.provider = body.provider
  if (body.model !== undefined) update.model = (body.model as string).trim()
  if (body.apiKey !== undefined) update.apiKey = body.apiKey
  if (body.baseUrl !== undefined) update.baseUrl = body.baseUrl
  if (body.parameters !== undefined) update.parameters = body.parameters
  if (body.isDefault !== undefined) update.isDefault = body.isDefault

  const config = await ModelConfigModel.findByIdAndUpdate(id, update, { new: true })

  clearLLMCache()

  ctx.body = { success: true, data: config }
})

// ────────────────────────────────────────────
// DELETE /api/model-configs/:id
// Delete model configuration
// ────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('model_config:delete'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await ModelConfigModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Model config not found.' } }
    return
  }

  await ModelConfigModel.findByIdAndDelete(id)

  clearLLMCache()

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

// ────────────────────────────────────────────
// POST /api/model-configs/:id/test
// Test model connectivity
// ────────────────────────────────────────────
router.post('/:id/test', requireAuth, validate(testModelConfigSchema), async (ctx) => {
  const { id } = ctx.params
  const { message } = ctx.request.body as { message?: string }

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const config = await ModelConfigModel.findById(id)
  if (!config) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Model config not found.' } }
    return
  }

  if (!config.apiKey && config.provider !== 'ollama') {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'API key is required for this provider.' } }
    return
  }

  try {
    const baseUrl = config.baseUrl || getDefaultBaseUrl(config.provider)
    const testMessage = message ?? 'Hello, respond with OK'

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: testMessage }],
        max_tokens: 50,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      ctx.status = 502
      ctx.body = {
        success: false,
        error: {
          message: `Provider returned HTTP ${response.status}`,
          details: errorBody.slice(0, 500),
        },
      }
      return
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { total_tokens?: number }
    }

    const reply = data.choices?.[0]?.message?.content ?? ''
    const tokens = data.usage?.total_tokens ?? 0

    ctx.body = {
      success: true,
      data: {
        reply: reply.slice(0, 200),
        tokens,
        model: config.model,
        provider: config.provider,
      },
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    ctx.status = 502
    ctx.body = {
      success: false,
      error: {
        message: 'Connection test failed',
        details: errorMsg,
      },
    }
  }
})

function getDefaultBaseUrl(provider: string): string {
  const baseUrls: Record<string, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    ollama: 'http://localhost:11434/v1',
  }
  return baseUrls[provider] ?? ''
}

export default router
