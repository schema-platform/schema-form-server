import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { WebhookModel } from '../models/Webhook.js'
import { WebhookLogModel } from '../models/WebhookLog.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createWebhookSchema, updateWebhookSchema } from '../schemas/webhookSchemas.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/webhooks' })

// ────────────────────────────────────────────
// POST /api/webhooks
// 创建 Webhook
// ────────────────────────────────────────────
router.post('/', requireAuth, requirePermission('webhook:create'), validate(createWebhookSchema), async (ctx) => {
  const body = ctx.request.body as {
    name: string
    url: string
    events: string[]
    secret: string
    status?: 'active' | 'inactive'
    retryPolicy?: { maxRetries?: number; backoffMs?: number }
  }

  const userId = (ctx.state.user as { id: string }).id

  const webhook = await WebhookModel.create({
    _id: uuidv4(),
    name: body.name,
    url: body.url,
    events: body.events,
    secret: body.secret,
    status: body.status ?? 'active',
    retryPolicy: {
      maxRetries: body.retryPolicy?.maxRetries ?? 3,
      backoffMs: body.retryPolicy?.backoffMs ?? 1000,
    },
    createdBy: userId,
  })

  ctx.status = 201
  ctx.body = { success: true, data: webhook }
})

// ────────────────────────────────────────────
// GET /api/webhooks
// 列表（分页）
// ────────────────────────────────────────────
router.get('/', requireAuth, requirePermission('webhook:view'), async (ctx) => {
  const { status, event, page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query
  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (status && ['active', 'inactive'].includes(status as string)) {
    filter.status = status
  }
  if (event) {
    filter.events = event
  }

  const [items, total] = await Promise.all([
    WebhookModel.find(filter).skip(skip).limit(pageSize).sort({ createdAt: -1 }),
    WebhookModel.countDocuments(filter),
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
// GET /api/webhooks/:id
// 详情
// ────────────────────────────────────────────
router.get('/:id', requireAuth, requirePermission('webhook:view'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const webhook = await WebhookModel.findById(id)
  if (!webhook) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Webhook not found.' } }
    return
  }

  ctx.body = { success: true, data: webhook }
})

// ────────────────────────────────────────────
// PUT /api/webhooks/:id
// 更新
// ────────────────────────────────────────────
router.put('/:id', requireAuth, requirePermission('webhook:edit'), validate(updateWebhookSchema), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const body = ctx.request.body as Record<string, unknown>

  const webhook = await WebhookModel.findByIdAndUpdate(id, { $set: body }, { new: true })
  if (!webhook) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Webhook not found.' } }
    return
  }

  ctx.body = { success: true, data: webhook }
})

// ────────────────────────────────────────────
// DELETE /api/webhooks/:id
// 删除
// ────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('webhook:delete'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const result = await WebhookModel.findByIdAndDelete(id)
  if (!result) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Webhook not found.' } }
    return
  }

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

// ────────────────────────────────────────────
// GET /api/webhooks/:id/logs
// 发送日志（分页）
// ────────────────────────────────────────────
router.get('/:id/logs', requireAuth, requirePermission('webhook:view'), async (ctx) => {
  const { id } = ctx.params
  const { event, status, page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = { webhookId: id }
  if (event) filter.event = event
  if (status && ['success', 'failed'].includes(status as string)) {
    filter.status = status
  }

  const [items, total] = await Promise.all([
    WebhookLogModel.find(filter).skip(skip).limit(pageSize).sort({ createdAt: -1 }),
    WebhookLogModel.countDocuments(filter),
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

export default router
