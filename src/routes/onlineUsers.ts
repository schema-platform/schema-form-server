import Router from '@koa/router'
import { SSOSessionModel } from '../models/SSOSession.js'
import { UserModel } from '../models/User.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/online-users' })

// GET /api/online-users — 在线用户列表
router.get('/', requireAuth, requirePermission('user:view'), async (ctx) => {
  const { page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query
  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  // Find active sessions (not expired)
  const now = new Date()
  const query = { expiresAt: { $gt: now } }

  const [sessions, total] = await Promise.all([
    SSOSessionModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize),
    SSOSessionModel.countDocuments(query),
  ])

  // Enrich with user info
  const userIds = [...new Set(sessions.map(s => s.userId))]
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select('username displayName tenantId')
  const userMap = new Map(users.map(u => [u._id, u.toJSON()]))

  const items = sessions.map(s => ({
    id: s._id,
    userId: s.userId,
    user: userMap.get(s.userId) || null,
    ip: s.ip,
    userAgent: s.userAgent,
    loginTime: s.createdAt,
    expireTime: s.expiresAt,
  }))

  ctx.body = {
    success: true,
    data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  }
})

// DELETE /api/online-users/:sessionId — 强制下线
router.delete('/:sessionId', requireAuth, requirePermission('user:edit'), async (ctx) => {
  const { sessionId } = ctx.params

  const session = await SSOSessionModel.findById(sessionId)
  if (!session) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: '会话不存在。' } }
    return
  }

  await SSOSessionModel.findByIdAndDelete(sessionId)
  ctx.body = { success: true, data: null }
})

export default router
