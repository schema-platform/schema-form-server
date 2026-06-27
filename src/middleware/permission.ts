import type { Middleware } from 'koa'
import { RoleModel } from '../models/Role.js'
import type { JwtPayload } from './auth.js'
import { cacheGet, cacheSet, cacheDelPattern } from '../utils/cache.js'

const PERMISSION_CACHE_TTL = 300 // 5 minutes

/**
 * Build cache key from sorted role IDs.
 */
function permCacheKey(roleIds: string[]): string {
  return `perm:${[...roleIds].sort().join(',')}`
}

/**
 * Get cached permissions for a set of role IDs.
 * Returns null on cache miss.
 */
async function getCachedPermissions(roleIds: string[]): Promise<string[] | null> {
  const key = permCacheKey(roleIds)
  const cached = await cacheGet(key)
  if (cached) {
    try { return JSON.parse(cached) } catch { /* ignore */ }
  }
  return null
}

/**
 * Cache permissions for a set of role IDs.
 */
async function setCachedPermissions(roleIds: string[], permissions: string[]): Promise<void> {
  const key = permCacheKey(roleIds)
  await cacheSet(key, JSON.stringify(permissions), PERMISSION_CACHE_TTL)
}

/**
 * Invalidate all permission caches.
 * Call this when any role's permissions are updated.
 */
export async function invalidatePermissionCache(): Promise<void> {
  await cacheDelPattern('perm:*')
}

/**
 * 权限检查中间件
 * @param requiredPermissions - 需要的权限编码数组（任一即可）
 */
export function requirePermission(...requiredPermissions: string[]): Middleware {
  return async (ctx, next) => {
    // 通过环境变量控制是否跳过权限检查
    if (process.env.SKIP_PERMISSION_CHECK === 'true') {
      await next()
      return
    }

    const user = ctx.state.user as JwtPayload | undefined
    if (!user) {
      ctx.status = 401
      ctx.body = { success: false, error: { message: 'Authentication required.' } }
      return
    }

    // Get user permissions (with cache)
    let userPermissions: Set<string>
    const roleIds = user.roles

    if (roleIds.length > 0) {
      const cached = await getCachedPermissions(roleIds)
      if (cached) {
        userPermissions = new Set(cached)
      } else {
        const roles = await RoleModel.find({ _id: { $in: roleIds } })
        const perms = roles.flatMap(r => r.permissions)
        userPermissions = new Set(perms)
        await setCachedPermissions(roleIds, perms)
      }
    } else {
      userPermissions = new Set()
    }

    // 检查是否有任一所需权限
    const hasPermission = requiredPermissions.some(p => userPermissions.has(p))

    if (!hasPermission) {
      ctx.status = 403
      ctx.body = {
        success: false,
        error: {
          message: 'Permission denied.',
          required: requiredPermissions,
          current: Array.from(userPermissions),
        },
      }
      return
    }

    await next()
  }
}

/**
 * 角色检查中间件
 * @param requiredRoles - 需要的角色名称数组（任一即可）
 */
export function requireRole(...requiredRoles: string[]): Middleware {
  return async (ctx, next) => {
    // 通过环境变量控制是否跳过角色检查
    if (process.env.SKIP_PERMISSION_CHECK === 'true') {
      await next()
      return
    }

    const user = ctx.state.user as JwtPayload | undefined
    if (!user) {
      ctx.status = 401
      ctx.body = { success: false, error: { message: 'Authentication required.' } }
      return
    }

    // 获取用户所有角色名称
    const roles = await RoleModel.find({ _id: { $in: user.roles } })
    const roleNames = roles.map(r => r.name)

    // 检查是否有任一所需角色
    const hasRole = requiredRoles.some(r => roleNames.includes(r))

    if (!hasRole) {
      ctx.status = 403
      ctx.body = {
        success: false,
        error: {
          message: 'Role denied.',
          required: requiredRoles,
          current: roleNames,
        },
      }
      return
    }

    await next()
  }
}
