import type { Middleware } from 'koa'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/jwt.js'
import { tenantStorage } from './tenantContext.js'
import { cacheExists } from '../utils/cache.js'
import { SSOSessionModel } from '../models/SSOSession.js'
import { UserModel } from '../models/User.js'

export interface JwtPayload {
  id: string
  username: string
  roles: string[]
  tenantId: string
  deptId: string | null
  tokenType: 'access' | 'refresh'
  jti?: string
}

/**
 * Sync tenantId from JWT payload into tenant context.
 * Called after ctx.state.user is set by auth middleware.
 */
function syncTenantFromUser(ctx: { state: Record<string, unknown> }): void {
  const user = ctx.state.user as JwtPayload | undefined
  if (user?.tenantId) {
    ctx.state.tenantId = user.tenantId
    const store = tenantStorage.getStore()
    if (store) {
      store.tenantId = user.tenantId
    }
  }
}

/**
 * Check if a token's jti is in the blacklist (logged out).
 */
async function isTokenBlacklisted(jti?: string): Promise<boolean> {
  if (!jti) return false
  return cacheExists(`token:blacklist:${jti}`)
}

/**
 * Try to resolve user from SSO session cookie.
 * Used as fallback when Authorization header is missing (e.g., micro-apps loaded via qiankun).
 */
async function resolveUserFromSSOSession(ctx: { cookies: { get: (name: string) => string | undefined } }): Promise<JwtPayload | null> {
  const sessionToken = ctx.cookies.get('sso_session')
  if (!sessionToken) return null

  try {
    const session = await SSOSessionModel.findOne({
      sessionToken,
      expiresAt: { $gt: new Date() },
    })
    if (!session) return null

    const user = await UserModel.findById(session.userId).lean() as Record<string, unknown> | null
    if (!user || user.status !== 'active') return null

    return {
      id: (user._id as { toString(): string }).toString(),
      username: user.username as string,
      roles: (user.roles as string[]) || [],
      tenantId: (user.tenantId as string) || '000000',
      deptId: (user.deptId as string) || null,
      tokenType: 'access',
    }
  } catch {
    return null
  }
}

export function authMiddleware(options?: { required?: boolean }): Middleware {
  const required = options?.required ?? true

  return async (ctx, next) => {
    // 本地开发：尝试从 token 解析真实用户，失败则 fallback 到 dev
    if (process.env.NODE_ENV !== 'production') {
      const authHeader = ctx.get('Authorization')
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.slice(7)
          const payload = jwt.verify(token, JWT_SECRET) as JwtPayload
          if (payload.tokenType !== 'refresh') {
            // Check blacklist
            if (await isTokenBlacklisted(payload.jti)) {
              ctx.status = 401
              ctx.body = { success: false, error: { message: 'Token has been revoked.' } }
              return
            }
            ctx.state.user = payload
            syncTenantFromUser(ctx)
            await next()
            return
          }
        } catch { /* token invalid, use dev fallback */ }
      }
      // Dev fallback: 数据库真实用户（默认 admin），与 WebSocket 一致
      try {
        const { resolveDevelopmentUser } = await import('../utils/devUser.js')
        ctx.state.user = await resolveDevelopmentUser()
      } catch (err) {
        ctx.status = 503
        ctx.body = {
          success: false,
          error: {
            message: err instanceof Error ? err.message : 'Development auth user not available',
          },
        }
        return
      }
      syncTenantFromUser(ctx)
      await next()
      return
    }
    const authHeader = ctx.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No Authorization header — try SSO session cookie as fallback
      // This enables SSO for micro-apps (editor/flow/ai) loaded via qiankun
      const ssoUser = await resolveUserFromSSOSession(ctx)
      if (ssoUser) {
        ctx.state.user = ssoUser
        syncTenantFromUser(ctx)
        await next()
        return
      }
      if (required) {
        ctx.status = 401
        ctx.body = { success: false, error: { message: 'Authentication required.' } }
        return
      }
      await next()
      return
    }

    const token = authHeader.slice(7)
    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload
      // 只接受 access token，refresh token 不能用于访问 API
      if (payload.tokenType === 'refresh') {
        ctx.status = 401
        ctx.body = { success: false, error: { message: 'Access token required. Refresh token cannot be used for API access.' } }
        return
      }
      // Check blacklist
      if (await isTokenBlacklisted(payload.jti)) {
        ctx.status = 401
        ctx.body = { success: false, error: { message: 'Token has been revoked.' } }
        return
      }
      ctx.state.user = payload
      syncTenantFromUser(ctx)
    } catch {
      if (required) {
        ctx.status = 401
        ctx.body = { success: false, error: { message: 'Invalid or expired token.' } }
        return
      }
    }

    await next()
  }
}
