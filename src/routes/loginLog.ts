import Router from '@koa/router'
import { LoginLogModel } from '../models/LoginLog.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/login-logs' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// GET /api/login-logs — 登录日志列表
router.get('/', requireAuth, requirePermission('audit:view'), async (ctx) => {
  const {
    username,
    status,
    ip,
    page: pageStr = '1',
    pageSize: pageSizeStr = '20',
    startTime,
    endTime,
  } = ctx.query

  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (username) filter.username = { $regex: escapeRegex(username as string), $options: 'i' }
  if (status && ['success', 'fail'].includes(status as string)) filter.status = status
  if (ip) filter.ip = { $regex: escapeRegex(ip as string), $options: 'i' }
  if (startTime || endTime) {
    const timeFilter: Record<string, unknown> = {}
    if (startTime) timeFilter.$gte = new Date(startTime as string)
    if (endTime) timeFilter.$lte = new Date(endTime as string)
    filter.loginTime = timeFilter
  }

  const [items, total] = await Promise.all([
    LoginLogModel.find(filter)
      .sort({ loginTime: -1 })
      .skip(skip)
      .limit(pageSize),
    LoginLogModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items: items.map((i) => i.toJSON()),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// DELETE /api/login-logs — 清空登录日志
router.delete('/', requireAuth, requirePermission('audit:view'), async (ctx) => {
  await LoginLogModel.deleteMany({})
  ctx.body = { success: true, data: null }
})

export default router
