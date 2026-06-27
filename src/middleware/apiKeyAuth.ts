import type { Middleware } from 'koa'
import { ApiKeyModel } from '../models/ApiKey.js'

export interface ApiKeyAuthState {
  tenantId: string
  userId: string
  source: 'apiKey'
  keyId: string
  permissions: string[]
}

/**
 * API Key 认证中间件
 *
 * 从 X-API-Key header 读取 key，查找 ApiKeyModel 中匹配的记录，
 * 验证状态和过期时间，更新 lastUsedAt，注入 tenantId/userId 到 ctx.state。
 *
 * 必须提供有效的 key，否则返回 401。
 */
export function apiKeyAuthMiddleware(): Middleware {
  return async (ctx, next) => {
    const apiKey = ctx.get('X-API-Key')

    if (!apiKey) {
      ctx.status = 401
      ctx.body = {
        success: false,
        error: { message: 'X-API-Key header is required.' },
      }
      return
    }

    const record = await ApiKeyModel.findOne({ key: apiKey })

    if (!record) {
      ctx.status = 401
      ctx.body = {
        success: false,
        error: { message: 'Invalid API key.' },
      }
      return
    }

    if (record.status !== 'active') {
      ctx.status = 401
      ctx.body = {
        success: false,
        error: { message: 'API key is disabled.' },
      }
      return
    }

    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      ctx.status = 401
      ctx.body = {
        success: false,
        error: { message: 'API key has expired.' },
      }
      return
    }

    // 异步更新 lastUsedAt，不阻塞请求
    ApiKeyModel.updateOne({ _id: record._id }, { lastUsedAt: new Date() }).exec()

    ctx.state.auth = {
      tenantId: record.tenantId,
      userId: record.createdBy,
      source: 'apiKey',
      keyId: record._id,
      permissions: record.permissions,
    } satisfies ApiKeyAuthState

    await next()
  }
}
