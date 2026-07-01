/**
 * 开发环境统一用户解析 — REST 与 WebSocket 共用
 *
 * 使用数据库真实用户（默认 seed 的 admin），不再回退到字符串 "dev"。
 * 可通过环境变量覆盖：
 *   DEV_AUTH_USERNAME  默认 admin
 *   DEV_AUTH_TENANT_ID 默认 000000
 */

import type { JwtPayload } from '../middleware/auth.js'

export class DevAuthUserNotFoundError extends Error {
  constructor(username: string, tenantId: string) {
    super(
      `[dev-auth] User "${username}" not found in tenant ${tenantId}. `
      + 'Ensure MongoDB is running and seed admin exists (pnpm seed / server bootstrap). '
      + 'Override with DEV_AUTH_USERNAME / DEV_AUTH_TENANT_ID.',
    )
    this.name = 'DevAuthUserNotFoundError'
  }
}

export async function resolveDevelopmentUser(): Promise<JwtPayload> {
  const username = process.env.DEV_AUTH_USERNAME?.trim() || 'admin'
  const tenantId = process.env.DEV_AUTH_TENANT_ID?.trim() || '000000'

  const { UserModel } = await import('../models/User.js')
  const user = await UserModel.findOne({ username, tenantId }).lean() as Record<string, unknown> | null

  if (!user || user.status !== 'active') {
    throw new DevAuthUserNotFoundError(username, tenantId)
  }

  return {
    id: (user._id as { toString(): string }).toString(),
    username: user.username as string,
    roles: (user.roles as string[]) || [],
    tenantId: (user.tenantId as string) || tenantId,
    deptId: (user.deptId as string) || null,
    tokenType: 'access',
  }
}
