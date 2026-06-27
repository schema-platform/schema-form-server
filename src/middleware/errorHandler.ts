import type { Middleware } from 'koa'

interface AppError extends Error {
  status?: number
  expose?: boolean
}

export const errorHandler: Middleware = async (ctx, next) => {
  try {
    await next()
  } catch (err: unknown) {
    const appError = err as AppError
    const status = appError.status ?? 500
    const isExposed = appError.expose === true || status < 500
    const isDev = process.env.NODE_ENV === 'development'

    // 暴露的客户端错误（4xx）可直接返回消息，服务端错误（5xx）不暴露内部信息
    const message = isExposed
      ? appError.message || 'Bad Request'
      : isDev
        ? appError.message || 'Internal Server Error'
        : 'Internal Server Error'

    ctx.status = status
    ctx.body = {
      success: false,
      error: {
        message,
        status,
      },
    }

    // 结构化日志：5xx 错误记录完整堆栈
    if (status >= 500) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        status,
        method: ctx.method,
        url: ctx.url,
        ip: ctx.ip,
        userAgent: ctx.get('User-Agent'),
        requestId: ctx.get('X-Request-Id'),
        message: appError.message,
        stack: appError.stack,
      }
      console.error(JSON.stringify(logEntry))
    }

    ctx.app.emit('error', err, ctx)
  }
}
