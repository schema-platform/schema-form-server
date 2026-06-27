import type { Middleware } from 'koa'
import type { ZodSchema } from 'zod'

export function validate(schema: ZodSchema): Middleware {
  return async (ctx, next) => {
    const result = schema.safeParse(ctx.request.body)
    if (!result.success) {
      ctx.status = 400
      ctx.body = {
        success: false,
        error: {
          message: 'Validation failed',
          details: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      }
      return
    }
    ctx.request.body = result.data
    await next()
  }
}

export function validateQuery(schema: ZodSchema): Middleware {
  return async (ctx, next) => {
    const result = schema.safeParse(ctx.query)
    if (!result.success) {
      ctx.status = 400
      ctx.body = {
        success: false,
        error: {
          message: 'Validation failed',
          details: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      }
      return
    }
    ctx.query = result.data as typeof ctx.query
    await next()
  }
}
