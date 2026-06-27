import Router from '@koa/router'
import { flowEngine } from '../flow-services/FlowEngine.js'

const router = new Router({ prefix: '/api/flow-timers' })

/**
 * GET /api/flow-timers/check
 *
 * Polls for due timer jobs and fires them. Designed to be called by
 * Vercel Cron Jobs (which send GET requests on a schedule).
 *
 * Idempotent: re-calling before the next cron tick has no side effects
 * because already-fired jobs have status !== 'pending'.
 */
router.get('/check', async (ctx) => {
  const result = await flowEngine.fireDueTimers()
  ctx.body = { success: true, data: result }
})

export default router
