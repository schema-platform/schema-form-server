import type { Middleware } from 'koa'
import { AuditLogModel } from '../models/AuditLog.js'
import type { JwtPayload } from './auth.js'

/**
 * HTTP 方法到审计动作的映射
 */
const METHOD_ACTION_MAP: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
}

/**
 * URL 路径到模块名的映射
 * 从 URL 中提取 /api/{module} 作为模块名
 */
function extractModule(url: string): string {
  const match = url.match(/^\/api\/([^/?]+)/)
  return match ? match[1] : 'unknown'
}

/**
 * 敏感字段过滤：请求体中不应记录的字段
 */
const SENSITIVE_FIELDS = new Set(['password', 'token', 'secret', 'authorization', 'oldPassword', 'newPassword'])

function sanitizeBody(body: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      sanitized[key] = '******'
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

/**
 * 审计日志中间件
 *
 * 自动记录所有写操作（POST/PUT/PATCH/DELETE），读操作（GET）不记录。
 * 记录 who/what/when/where 信息。
 *
 * 对于路由级别的细粒度控制，可以在 ctx.state.auditLog 中设置：
 *   - module: 覆盖自动提取的模块名
 *   - action: 覆盖自动推断的动作
 *   - targetId: 操作目标 ID
 *   - targetName: 操作目标名称（用于日志展示）
 */
export const auditLogMiddleware: Middleware = async (ctx, next) => {
  const startTime = Date.now()
  const method = ctx.method

  // 只记录写操作
  if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') {
    await next()
    return
  }

  try {
    await next()
  } finally {
    const duration = Date.now() - startTime
    const user = ctx.state.user as JwtPayload | undefined

    // 从 ctx.state.auditLog 获取路由级别覆盖
    const auditState = (ctx.state.auditLog || {}) as {
      module?: string
      action?: string
      targetId?: string
      targetName?: string
    }

    const module = auditState.module || extractModule(ctx.url)
    const action = auditState.action || METHOD_ACTION_MAP[method] || 'other'

    // Extract response body for logging (only for errors, to avoid logging sensitive data)
    let responseBody: Record<string, unknown> | null = null
    let errorMsg = ''
    let errorStack = ''
    if (ctx.status >= 400 && ctx.body && typeof ctx.body === 'object') {
      const body = ctx.body as Record<string, unknown>
      errorMsg = (body.error as { message?: string })?.message || ''
      responseBody = { success: body.success, error: body.error }
    }

    // Extract controller method from route path
    const controllerMethod = auditState.action || ctx._matchedRoute || ''

    // 异步写入，不阻塞响应
    AuditLogModel.create({
      userId: user?.id || '',
      username: user?.username || '',
      module,
      action,
      targetId: auditState.targetId || null,
      targetName: auditState.targetName || '',
      method,
      url: ctx.url,
      ip: ctx.ip,
      userAgent: ctx.get('User-Agent') || '',
      requestBody: sanitizeBody(ctx.request.body as Record<string, unknown> | undefined),
      responseBody,
      controllerMethod,
      status: ctx.status < 400 ? 'success' : 'fail',
      errorMsg,
      errorStack,
      duration,
    }).catch((err: unknown) => {
      console.error('[auditLog] Failed to write audit log:', err instanceof Error ? err.message : String(err))
    })
  }
}
