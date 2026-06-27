import Router from '@koa/router'
import { validate as uuidValidate } from 'uuid'
import { AuditLogModel } from '../models/AuditLog.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/audit-logs' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// GET /api/audit-logs — 日志列表（分页+搜索+筛选）
router.get('/', requireAuth, requirePermission('audit:view'), async (ctx) => {
  const q = ctx.query.q as string
  const module = ctx.query.module as string
  const action = ctx.query.action as string
  const status = ctx.query.status as string
  const username = ctx.query.username as string
  const startDate = ctx.query.startDate as string
  const endDate = ctx.query.endDate as string
  const page = Math.max(1, parseInt(ctx.query.page as string) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(ctx.query.pageSize as string) || 20))

  const filter: Record<string, unknown> = {}

  if (q) {
    filter.$or = [
      { username: { $regex: escapeRegex(q), $options: 'i' } },
      { module: { $regex: escapeRegex(q), $options: 'i' } },
      { targetName: { $regex: escapeRegex(q), $options: 'i' } },
      { url: { $regex: escapeRegex(q), $options: 'i' } },
    ]
  }
  if (module) filter.module = module
  if (action && ['create', 'update', 'delete', 'login', 'logout', 'export', 'import', 'other'].includes(action)) {
    filter.action = action
  }
  if (status && ['success', 'fail'].includes(status)) {
    filter.status = status
  }
  if (username) {
    filter.username = { $regex: escapeRegex(username), $options: 'i' }
  }
  if (startDate || endDate) {
    const createdAt: Record<string, Date> = {}
    if (startDate) createdAt.$gte = new Date(startDate)
    if (endDate) createdAt.$lte = new Date(endDate)
    filter.createdAt = createdAt
  }

  const [items, total] = await Promise.all([
    AuditLogModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select({ requestBody: 0 }), // 默认不返回请求体，减少传输
    AuditLogModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items: items.map((l) => l.toJSON()),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// GET /api/audit-logs/:id — 获取单条日志详情（含请求体）
router.get('/:id', requireAuth, requirePermission('audit:view'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const log = await AuditLogModel.findById(id)
  if (!log) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: '日志不存在' } }
    return
  }

  ctx.body = { success: true, data: log.toJSON() }
})

// GET /api/audit-logs/modules/list — 获取所有模块名（用于筛选下拉）
router.get('/modules/list', requireAuth, requirePermission('audit:view'), async (ctx) => {
  const modules = await AuditLogModel.distinct('module')
  ctx.body = { success: true, data: modules.filter(Boolean).sort() }
})

export default router
