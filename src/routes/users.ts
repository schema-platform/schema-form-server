import Router from '@koa/router'
import { UserModel } from '../models/User.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createUserSchema, updateUserSchema, resetPasswordSchema } from '../schemas/userSchemas.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/users' })

const USER_LIST_SELECT = 'username displayName roles tenantId deptId email phone avatar status'

// GET /api/users?q=xxx&page=1&pageSize=20&tenantId=xxx&deptId=xxx&status=active — 搜索用户（分页+搜索+筛选）
router.get('/', requireAuth, requirePermission('user:view'), async (ctx) => {
  const q = ctx.query.q as string
  const page = Math.max(1, parseInt(ctx.query.page as string) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(ctx.query.pageSize as string) || 20))
  const { tenantId, deptId, status, roleId } = ctx.query as { tenantId?: string; deptId?: string; status?: string; roleId?: string }

  const filter: Record<string, unknown> = {}
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [
      { username: { $regex: escaped, $options: 'i' } },
      { displayName: { $regex: escaped, $options: 'i' } },
    ]
  }
  if (tenantId) filter.tenantId = tenantId
  if (deptId) filter.deptId = deptId
  if (status) filter.status = status
  if (roleId) filter.roles = roleId

  const [users, total] = await Promise.all([
    UserModel.find(filter)
      .select(USER_LIST_SELECT)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize),
    UserModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items: users.map(u => u.toJSON()),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// GET /api/users/:id — 获取单个用户
router.get('/:id', requireAuth, requirePermission('user:view'), async (ctx) => {
  const currentUser = ctx.state.user as { tenantId: string }
  const user = await UserModel.findOne({ _id: ctx.params.id, tenantId: currentUser.tenantId }).select(USER_LIST_SELECT)
  if (!user) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'User not found' } }
    return
  }
  ctx.body = { success: true, data: user.toJSON() }
})

// POST /api/users — 创建用户
router.post('/', requireAuth, requirePermission('user:create'), validate(createUserSchema), async (ctx) => {
  const body = ctx.request.body as {
    username: string
    password: string
    displayName: string
    roles: string[]
    tenantId?: string
    deptId?: string | null
    email?: string | null
    phone?: string | null
    avatar?: string
    status?: string
  }

  // 强制使用当前请求者的 tenantId，忽略 body 中的 tenantId
  const currentUser = ctx.state.user as { tenantId: string }
  const tenantId = currentUser.tenantId

  // 在同一租户内检查 username 唯一性
  const existing = await UserModel.findOne({ username: body.username, tenantId })
  if (existing) {
    ctx.status = 409
    ctx.body = { success: false, error: { message: 'Username already exists in this tenant.' } }
    return
  }

  const user = await UserModel.create({ ...body, tenantId })
  ctx.status = 201
  ctx.body = { success: true, data: user.toJSON() }
})

// PUT /api/users/:id — 更新用户资料/角色/扩展字段
router.put('/:id', requireAuth, requirePermission('user:edit'), validate(updateUserSchema), async (ctx) => {
  const updates = ctx.request.body as Record<string, unknown>
  const currentUser = ctx.state.user as { tenantId: string }

  // 如果 body 中包含 tenantId，必须与当前请求者的 tenantId 一致
  if (updates.tenantId !== undefined && updates.tenantId !== currentUser.tenantId) {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'Cannot assign user to a different tenant.' } }
    return
  }

  // 确保更新限定在当前租户范围内
  const user = await UserModel.findOneAndUpdate(
    { _id: ctx.params.id, tenantId: currentUser.tenantId },
    { $set: updates },
    { new: true, runValidators: true },
  ).select(USER_LIST_SELECT)

  if (!user) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'User not found' } }
    return
  }

  ctx.body = { success: true, data: user.toJSON() }
})

// DELETE /api/users/:id — 删除用户
router.delete('/:id', requireAuth, requirePermission('user:delete'), async (ctx) => {
  const currentUser = ctx.state.user as { tenantId: string }
  const user = await UserModel.findOneAndDelete({ _id: ctx.params.id, tenantId: currentUser.tenantId })
  if (!user) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'User not found' } }
    return
  }

  ctx.body = { success: true, data: null }
})

// PUT /api/users/:id/password — 重置密码
router.put('/:id/password', requireAuth, requirePermission('user:reset-password'), validate(resetPasswordSchema), async (ctx) => {
  const { password } = ctx.request.body as { password: string }
  const currentUser = ctx.state.user as { tenantId: string }
  const user = await UserModel.findOne({ _id: ctx.params.id, tenantId: currentUser.tenantId })
  if (!user) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'User not found' } }
    return
  }

  user.password = password // pre-save hook will hash
  await user.save()

  ctx.body = { success: true, data: null }
})

export default router
