import Router from '@koa/router'
import { ApprovalLogModel } from '../flow-models/ApprovalLog.js'
import { authMiddleware } from '../middleware/auth.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/flow-approvals' })

// GET /api/flow-approvals?instanceId=xxx
router.get('/', requireAuth, async (ctx) => {
  const { instanceId } = ctx.query
  if (!instanceId || typeof instanceId !== 'string') {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'instanceId is required' } }
    return
  }
  const logs = await ApprovalLogModel.find({ instanceId }).sort({ createdAt: 1 })
  ctx.body = { success: true, data: logs }
})

export default router
