import Router from '@koa/router'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { UserModel } from '../models/User.js'
import { RoleModel } from '../models/Role.js'
import { TenantModel } from '../models/Tenant.js'
import { SSOSessionModel } from '../models/SSOSession.js'
import { LoginLogModel } from '../models/LoginLog.js'
import { authMiddleware } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { loginSchema, refreshSchema } from '../schemas/authSchemas.js'
import { JWT_SECRET } from '../config/jwt.js'
import type { JwtPayload } from '../middleware/auth.js'
import { cacheSet, cacheExists } from '../utils/cache.js'
import { createHash } from 'node:crypto'
import { validatePassword } from '../utils/passwordPolicy.js'

const router = new Router({ prefix: '/api/auth' })

/** Record login attempt (async, non-blocking) */
function recordLoginLog(tenantId: string, username: string, status: 'success' | 'fail', message: string, ctx: { ip: string; get: (name: string) => string }) {
  LoginLogModel.create({
    tenantId,
    username,
    status,
    ip: ctx.ip,
    userAgent: ctx.get('User-Agent') || '',
    message,
    loginTime: new Date(),
  }).catch(() => { /* ignore write errors */ })
}

/** Token expiry constants */
const ACCESS_TOKEN_EXPIRY = '15m'
const REFRESH_TOKEN_EXPIRY = '7d'
const SSO_SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const SSO_SESSION_COOKIE = 'sso_session'

/**
 * POST /api/auth/login
 *
 * Tenant resolution priority:
 * 1. `tenantCode` in request body (resolved to tenantId)
 * 2. `X-Tenant-Id` header
 * 3. Falls back to DEFAULT_TENANT_ID ('000000')
 */
router.post('/login', validate(loginSchema), async (ctx) => {
  const { username, password, tenantCode } = ctx.request.body as {
    username: string
    password: string
    tenantCode?: string
  }

  // Resolve tenantId
  const DEFAULT_TENANT_ID = '000000'
  let tenantId: string

  if (tenantCode) {
    // Resolve tenantCode to tenantId
    const tenant = await TenantModel.findOne({ code: tenantCode, status: 'active' })
    if (!tenant) {
      recordLoginLog(DEFAULT_TENANT_ID, username, 'fail', '租户不存在', ctx)
      ctx.status = 401
      ctx.body = { success: false, error: { message: 'Invalid tenant.' } }
      return
    }
    tenantId = tenant._id
  } else {
    tenantId = ctx.get('X-Tenant-Id') || DEFAULT_TENANT_ID
  }

  // Query user scoped to tenant
  const user = await UserModel.findOne({ username, tenantId })
  if (!user) {
    recordLoginLog(tenantId, username, 'fail', '用户不存在', ctx)
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'Invalid username or password.' } }
    return
  }

  const valid = await user.comparePassword(password)
  if (!valid) {
    recordLoginLog(tenantId, username, 'fail', '密码错误', ctx)
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'Invalid username or password.' } }
    return
  }

  const basePayload: Omit<JwtPayload, 'tokenType'> = {
    id: user._id,
    username: user.username,
    roles: user.roles,
    tenantId: user.tenantId,
    deptId: user.deptId,
  }

  const accessJti = crypto.randomUUID()
  const refreshJti = crypto.randomUUID()

  const accessToken = jwt.sign(
    { ...basePayload, tokenType: 'access', jti: accessJti },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  )

  const refreshToken = jwt.sign(
    { ...basePayload, tokenType: 'refresh', jti: refreshJti },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY },
  )

  // 创建 SSO 会话
  const sessionToken = crypto.randomBytes(32).toString('hex')
  await SSOSessionModel.create({
    userId: user._id,
    sessionToken,
    userAgent: ctx.get('User-Agent') || '',
    ip: ctx.ip,
    expiresAt: new Date(Date.now() + SSO_SESSION_EXPIRY_MS),
  })

  // 记录登录成功日志
  recordLoginLog(tenantId, username, 'success', '', ctx)

  // 设置 SSO 会话 cookie
  // 注意：secure 只在 HTTPS 下启用，当前服务器是 HTTP 所以关闭
  ctx.cookies.set(SSO_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: SSO_SESSION_EXPIRY_MS,
    path: '/',
  })

  ctx.body = {
    success: true,
    data: {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900, // 15 minutes in seconds
      user: user.toJSON(),
    },
  }
})

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new access token.
 */
router.post('/refresh', validate(refreshSchema), async (ctx) => {
  const { refreshToken } = ctx.request.body as { refreshToken: string }

  let payload: JwtPayload
  try {
    payload = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload
  } catch {
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'Invalid or expired refresh token.' } }
    return
  }

  if (payload.tokenType !== 'refresh') {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Token is not a refresh token.' } }
    return
  }

  // Verify user still exists
  const user = await UserModel.findById(payload.id)
  if (!user) {
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'User no longer exists.' } }
    return
  }

  const newAccessToken = jwt.sign(
    {
      id: user._id,
      username: user.username,
      roles: user.roles,
      tenantId: user.tenantId,
      deptId: user.deptId,
      tokenType: 'access' as const,
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  )

  ctx.body = {
    success: true,
    data: {
      accessToken: newAccessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
    },
  }
})

/**
 * POST /api/auth/logout
 */
router.post('/logout', async (ctx) => {
  // 将当前 access token 加入黑名单
  const authHeader = ctx.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as JwtPayload
      if (payload.jti) {
        // Blacklist for the remaining token lifetime (max 15min)
        await cacheSet(`token:blacklist:${payload.jti}`, '1', 900)
      }
    } catch { /* token already invalid, skip */ }
  }

  // 删除 SSO 会话
  const sessionToken = ctx.cookies.get(SSO_SESSION_COOKIE)
  if (sessionToken) {
    await SSOSessionModel.deleteOne({ sessionToken })
    ctx.cookies.set(SSO_SESSION_COOKIE, '', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
  }

  ctx.body = { success: true, data: null }
})

/**
 * GET /api/auth/me
 *
 * Returns user info with resolved permissions from roles.
 */
router.get('/me', authMiddleware({ required: true }), async (ctx) => {
  const payload = ctx.state.user as JwtPayload

  // 开发模式 fallback：auth 中间件注入的 dev 用户
  if (payload.id === 'dev') {
    // 查找第一个有管理员角色的用户作为 dev 用户
    const adminRole = await RoleModel.findOne({ name: '管理员' })
    if (adminRole) {
      const adminUser = await UserModel.findOne({ roles: adminRole._id })
      if (adminUser) {
        const roles = await RoleModel.find({ _id: { $in: adminUser.roles } })
        const permissions = [...new Set(roles.flatMap((r) => r.permissions))]
        ctx.body = {
          success: true,
          data: { ...adminUser.toJSON(), permissions },
        }
        return
      }
    }
    // fallback：返回基础 dev 信息
    ctx.body = {
      success: true,
      data: {
        id: 'dev',
        username: 'dev',
        displayName: 'Dev User',
        roles: [],
        permissions: [],
        tenantId: '000000',
        deptId: null,
      },
    }
    return
  }

  const user = await UserModel.findById(payload.id)
  if (!user) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'User not found.' } }
    return
  }

  // Resolve permissions from user's roles
  const roles = await RoleModel.find({ _id: { $in: user.roles } })
  const permissions = [...new Set(roles.flatMap((r) => r.permissions))]

  ctx.body = {
    success: true,
    data: {
      ...user.toJSON(),
      permissions,
    },
  }
})

/**
 * POST /api/auth/register
 *
 * 用户自主注册（开放接口，不需要 token）
 */
router.post('/register', async (ctx) => {
  const { username, password, displayName, phone } = ctx.request.body as {
    username: string
    password: string
    displayName?: string
    phone?: string
  }

  if (!username || !password) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: '用户名和密码不能为空。' } }
    return
  }

  const passwordCheck = validatePassword(password)
  if (!passwordCheck.valid) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: passwordCheck.message } }
    return
  }

  const DEFAULT_TENANT_ID = '000000'
  const tenantId = ctx.get('X-Tenant-Id') || DEFAULT_TENANT_ID

  // 检查用户名是否已存在
  const existing = await UserModel.findOne({ username, tenantId })
  if (existing) {
    ctx.status = 409
    ctx.body = { success: false, error: { message: '用户名已存在。' } }
    return
  }

  // 查找默认"普通用户"角色
  const defaultRole = await RoleModel.findOne({ name: '普通用户', tenantId })
  const defaultRoles = defaultRole ? [defaultRole._id] : []

  // 创建用户（自动分配普通用户角色）
  const user = await UserModel.create({
    _id: crypto.randomUUID(),
    username,
    password,
    displayName: displayName || username,
    phone: phone || '',
    roles: defaultRoles,
    tenantId,
    status: 'active',
  })

  ctx.status = 201
  ctx.body = {
    success: true,
    data: {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
    },
  }
})

/**
 * POST /api/auth/change-password
 *
 * 已登录用户修改密码
 */
router.post('/change-password', authMiddleware({ required: true }), async (ctx) => {
  const payload = ctx.state.user as JwtPayload
  const { oldPassword, newPassword } = ctx.request.body as {
    oldPassword: string
    newPassword: string
  }

  if (!oldPassword || !newPassword) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: '旧密码和新密码不能为空。' } }
    return
  }

  const passwordCheck = validatePassword(newPassword)
  if (!passwordCheck.valid) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: passwordCheck.message } }
    return
  }

  const user = await UserModel.findById(payload.id)
  if (!user) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: '用户不存在。' } }
    return
  }

  const valid = await user.comparePassword(oldPassword)
  if (!valid) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: '旧密码错误。' } }
    return
  }

  user.password = newPassword
  await user.save()

  ctx.body = { success: true, data: null }
})

export default router
