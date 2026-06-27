import Router from '@koa/router'
import { validate as uuidValidate } from 'uuid'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { taskService } from '../flow-services/TaskService.js'

const requireAuth = authMiddleware({ required: true })

const batchTaskSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1, 'At least one task ID is required').max(100, 'Maximum 100 tasks per batch'),
})

const batchRejectSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1, 'At least one task ID is required').max(100, 'Maximum 100 tasks per batch'),
  reason: z.string().optional(),
})

const router = new Router({ prefix: '/api/flow-tasks/batch' })

interface BatchResult {
  taskId: string
  success: boolean
  error?: string
}

// POST /api/flow-tasks/batch/approve
router.post('/approve', requireAuth, validate(batchTaskSchema), async (ctx) => {
  const { taskIds } = ctx.request.body as { taskIds: string[] }
  const userId = (ctx.state.user as { id: string }).id

  const results: BatchResult[] = []

  for (const taskId of taskIds) {
    try {
      await taskService.approveTask(taskId, userId)
      results.push({ taskId, success: true })
    } catch (error) {
      results.push({
        taskId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.filter((r) => !r.success).length

  ctx.body = {
    success: true,
    data: {
      results,
      summary: { total: taskIds.length, success: successCount, failed: failCount },
    },
  }
})

// POST /api/flow-tasks/batch/reject
router.post('/reject', requireAuth, validate(batchRejectSchema), async (ctx) => {
  const { taskIds, reason } = ctx.request.body as { taskIds: string[]; reason?: string }
  const userId = (ctx.state.user as { id: string }).id

  const results: BatchResult[] = []

  for (const taskId of taskIds) {
    try {
      await taskService.rejectTask(taskId, userId, { reason })
      results.push({ taskId, success: true })
    } catch (error) {
      results.push({
        taskId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.filter((r) => !r.success).length

  ctx.body = {
    success: true,
    data: {
      results,
      summary: { total: taskIds.length, success: successCount, failed: failCount },
    },
  }
})

export default router
