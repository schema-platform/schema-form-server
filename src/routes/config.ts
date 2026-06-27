import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { ConfigModel } from '../models/Config.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createConfigSchema, updateConfigSchema } from '../schemas/configSchemas.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/config' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// GET /api/config — 参数列表（分页+搜索+筛选）
router.get('/', requireAuth, requirePermission('config:view'), async (ctx) => {
  const q = ctx.query.q as string
  const type = ctx.query.type as string
  const status = ctx.query.status as string
  const page = Math.max(1, parseInt(ctx.query.page as string) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(ctx.query.pageSize as string) || 20))

  const filter: Record<string, unknown> = {}
  if (q) {
    filter.$or = [
      { name: { $regex: escapeRegex(q), $options: 'i' } },
      { key: { $regex: escapeRegex(q), $options: 'i' } },
    ]
  }
  if (type && ['system', 'business'].includes(type)) {
    filter.type = type
  }
  if (status && ['active', 'inactive'].includes(status)) {
    filter.status = status
  }

  const [items, total] = await Promise.all([
    ConfigModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    ConfigModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items: items.map((c) => c.toJSON()),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// GET /api/config/key/:key — 按 key 查询参数值
router.get('/key/:key', requireAuth, async (ctx) => {
  const { key } = ctx.params

  const config = await ConfigModel.findOne({ key, status: 'active' })
  if (!config) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: '参数不存在或已停用' } }
    return
  }

  ctx.body = { success: true, data: config.toJSON() }
})

// GET /api/config/:id — 获取单个参数
router.get('/:id', requireAuth, requirePermission('config:view'), async (ctx) => {
  const { id } = ctx.params
  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const config = await ConfigModel.findById(id)
  if (!config) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: '参数不存在' } }
    return
  }

  ctx.body = { success: true, data: config.toJSON() }
})

// POST /api/config — 创建参数
router.post('/', requireAuth, requirePermission('config:create'), validate(createConfigSchema), async (ctx) => {
  const body = ctx.request.body as {
    name: string; key: string; value?: string; type?: string; status?: string; remark?: string
  }

  const existing = await ConfigModel.findOne({ key: body.key })
  if (existing) {
    ctx.status = 409
    ctx.body = { success: false, error: { message: '参数键名已存在' } }
    return
  }

  const config = await ConfigModel.create({
    _id: uuidv4(),
    name: body.name,
    key: body.key,
    value: body.value ?? '',
    type: body.type ?? 'business',
    status: body.status ?? 'active',
    remark: body.remark ?? '',
  })

  ctx.status = 201
  ctx.body = { success: true, data: config.toJSON() }
})

// PUT /api/config/:id — 更新参数
router.put('/:id', requireAuth, requirePermission('config:edit'), validate(updateConfigSchema), async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as {
    name?: string; key?: string; value?: string; type?: string; status?: string; remark?: string
  }

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  if (body.key) {
    const existing = await ConfigModel.findOne({ key: body.key, _id: { $ne: id } })
    if (existing) {
      ctx.status = 409
      ctx.body = { success: false, error: { message: '参数键名已存在' } }
      return
    }
  }

  const config = await ConfigModel.findByIdAndUpdate(
    id,
    { $set: body },
    { new: true, runValidators: true },
  )

  if (!config) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: '参数不存在' } }
    return
  }

  ctx.body = { success: true, data: config.toJSON() }
})

// DELETE /api/config/:id — 删除参数
router.delete('/:id', requireAuth, requirePermission('config:delete'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const config = await ConfigModel.findById(id)
  if (!config) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: '参数不存在' } }
    return
  }

  await ConfigModel.findByIdAndDelete(id)
  ctx.body = { success: true, data: null }
})

export default router
