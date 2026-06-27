import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { MicroAppModel } from '../models/MicroApp.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createMicroAppSchema, updateMicroAppSchema } from '../schemas/microAppSchemas.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/micro-apps' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// GET /api/micro-apps — 微应用列表（分页+搜索+筛选）
router.get('/', requireAuth, requirePermission('microapp:view'), async (ctx) => {
  const q = ctx.query.q as string
  const status = ctx.query.status as string
  const page = Math.max(1, parseInt(ctx.query.page as string) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(ctx.query.pageSize as string) || 20))

  const filter: Record<string, unknown> = {}
  if (q) {
    filter.$or = [
      { name: { $regex: escapeRegex(q), $options: 'i' } },
      { activeRule: { $regex: escapeRegex(q), $options: 'i' } },
    ]
  }
  if (status && ['active', 'inactive'].includes(status)) {
    filter.status = status
  }

  const [items, total] = await Promise.all([
    MicroAppModel.find(filter)
      .sort({ sort: 1, createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    MicroAppModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items: items.map((app) => app.toJSON()),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// GET /api/micro-apps/:id — 获取单个微应用
router.get('/:id', requireAuth, requirePermission('microapp:view'), async (ctx) => {
  const { id } = ctx.params
  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const microApp = await MicroAppModel.findById(id)
  if (!microApp) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: '微应用不存在' } }
    return
  }

  ctx.body = { success: true, data: microApp.toJSON() }
})

// POST /api/micro-apps — 创建微应用
router.post('/', requireAuth, requirePermission('microapp:create'), validate(createMicroAppSchema), async (ctx) => {
  const body = ctx.request.body as {
    name: string
    url: string
    icon?: string
    layout?: string
    activeRule: string
    permissions?: string[]
    status?: string
    sort?: number
    remark?: string
  }

  const existing = await MicroAppModel.findOne({ activeRule: body.activeRule })
  if (existing) {
    ctx.status = 409
    ctx.body = { success: false, error: { message: '激活规则已存在' } }
    return
  }

  const microApp = await MicroAppModel.create({
    _id: uuidv4(),
    name: body.name,
    url: body.url,
    icon: body.icon ?? '',
    layout: body.layout ?? 'with-menu',
    activeRule: body.activeRule,
    permissions: body.permissions ?? [],
    status: body.status ?? 'active',
    sort: body.sort ?? 0,
    remark: body.remark ?? '',
  })

  ctx.status = 201
  ctx.body = { success: true, data: microApp.toJSON() }
})

// PUT /api/micro-apps/:id — 更新微应用
router.put('/:id', requireAuth, requirePermission('microapp:edit'), validate(updateMicroAppSchema), async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as {
    name?: string
    url?: string
    icon?: string
    layout?: string
    activeRule?: string
    permissions?: string[]
    status?: string
    sort?: number
    remark?: string
  }

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  // Check activeRule uniqueness if changing
  if (body.activeRule) {
    const existing = await MicroAppModel.findOne({ activeRule: body.activeRule, _id: { $ne: id } })
    if (existing) {
      ctx.status = 409
      ctx.body = { success: false, error: { message: '激活规则已存在' } }
      return
    }
  }

  const microApp = await MicroAppModel.findByIdAndUpdate(
    id,
    { $set: body },
    { new: true, runValidators: true },
  )

  if (!microApp) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: '微应用不存在' } }
    return
  }

  ctx.body = { success: true, data: microApp.toJSON() }
})

// DELETE /api/micro-apps/:id — 删除微应用
router.delete('/:id', requireAuth, requirePermission('microapp:delete'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const microApp = await MicroAppModel.findById(id)
  if (!microApp) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: '微应用不存在' } }
    return
  }

  await MicroAppModel.findByIdAndDelete(id)
  ctx.body = { success: true, data: null }
})

export default router
