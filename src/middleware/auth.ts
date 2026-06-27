import type { Middleware } from 'koa'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/jwt.js'
import { tenantStorage } from './tenantContext.js'
import { cacheExists } from '../utils/cache.js'

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
      ctx.state.user = { id: 'dev', username: 'dev', roles: [], tenantId: '000000', deptId: null }
      syncTenantFromUser(ctx)
      await next()
      return
    }
    const authHeader = ctx.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
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
