import Router from '@koa/router'
import { ApiKeyModel } from '../models/ApiKey.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createApiKeySchema, updateApiKeyStatusSchema } from '../schemas/apiKeySchemas.js'
import type { JwtPayload } from '../middleware/auth.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/keys' })

// Mask key for list/detail responses: show prefix + masked middle + last 4 chars
function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 6) + '****'
  return key.slice(0, 6) + '****' + key.slice(-4)
}

// ────────────────────────────────────────────
// POST /api/keys — 创建 API Key（返回完整 key，只显示一次）
// ────────────────────────────────────────────
router.post('/', requireAuth, requirePermission('apikey:create'), validate(createApiKeySchema), async (ctx) => {
  const body = ctx.request.body as {
    name: string
    permissions: string[]
    expiresAt?: string | null
  }

  const user = ctx.state.user as JwtPayload

  const apiKey = await ApiKeyModel.create({
    name: body.name,
    permissions: body.permissions,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    createdBy: user.id,
    tenantId: user.tenantId,
  })

  const json = apiKey.toJSON()
  // Return full key only on creation
  json.key = apiKey.key

  ctx.status = 201
  ctx.body = { success: true, data: json }
})

// ────────────────────────────────────────────
// GET /api/keys — 列表（不返回完整 key，只返回前缀）
// ────────────────────────────────────────────
router.get('/', requireAuth, requirePermission('apikey:view'), async (ctx) => {
  const user = ctx.state.user as JwtPayload
  const page = Math.max(1, parseInt(ctx.query.page as string) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(ctx.query.pageSize as string) || 20))
  const { status } = ctx.query as { status?: string }

  const filter: Record<string, unknown> = { tenantId: user.tenantId }
  if (status && ['active', 'disabled'].includes(status)) {
    filter.status = status
  }

  const [keys, total] = await Promise.all([
    ApiKeyModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    ApiKeyModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items: keys.map((k) => {
        const json = k.toJSON()
        json.key = maskKey(k.key)
        return json
      }),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// ────────────────────────────────────────────
// GET /api/keys/:id — 详情（不返回完整 key）
// ────────────────────────────────────────────
router.get('/:id', requireAuth, requirePermission('apikey:view'), async (ctx) => {
  const user = ctx.state.user as JwtPayload
  const key = await ApiKeyModel.findOne({ _id: ctx.params.id, tenantId: user.tenantId })
  if (!key) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'API Key not found.' } }
    return
  }

  const json = key.toJSON()
  json.key = maskKey(key.key)

  ctx.body = { success: true, data: json }
})

// ────────────────────────────────────────────
// DELETE /api/keys/:id — 删除
// ────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('apikey:delete'), async (ctx) => {
  const user = ctx.state.user as JwtPayload
  const key = await ApiKeyModel.findOneAndDelete({ _id: ctx.params.id, tenantId: user.tenantId })
  if (!key) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'API Key not found.' } }
    return
  }

  ctx.body = { success: true, data: null }
})

// ────────────────────────────────────────────
// PATCH /api/keys/:id/status — 启用/禁用
// ────────────────────────────────────────────
router.patch('/:id/status', requireAuth, requirePermission('apikey:edit'), validate(updateApiKeyStatusSchema), async (ctx) => {
  const user = ctx.state.user as JwtPayload
  const { status } = ctx.request.body as { status: 'active' | 'disabled' }

  const key = await ApiKeyModel.findOneAndUpdate(
    { _id: ctx.params.id, tenantId: user.tenantId },
    { $set: { status } },
    { new: true, runValidators: true },
  )

  if (!key) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'API Key not found.' } }
    return
  }

  const json = key.toJSON()
  json.key = maskKey(key.key)

  ctx.body = { success: true, data: json }
})

export default router
