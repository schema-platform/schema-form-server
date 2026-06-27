/**
 * Flow Action API - 按钮事件驱动的流程推进
 *
 * POST /api/flow-actions/submit   — 提交表单并推进流程
 * POST /api/flow-actions/approve  — 审批通过
 * POST /api/flow-actions/reject   — 审批拒绝
 */
import Router from '@koa/router'
import { v4 as uuidv4 } from 'uuid'
import { authMiddleware } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { z } from 'zod'
import { FlowDefinitionModel } from '../flow-models/FlowDefinition.js'
import { FlowVersionModel } from '../flow-models/FlowVersion.js'
import { FlowInstanceModel } from '../flow-models/FlowInstance.js'
import { TaskInstanceModel } from '../flow-models/TaskInstance.js'
import { FlowEngine } from '../flow-services/FlowEngine.js'
import { socketService } from '../services/socketService.js'
import { logger } from '../utils/logger.js'

const router = new Router({ prefix: '/api/flow-actions' })
const requireAuth = authMiddleware({ required: true })

// ── Schemas ──

const submitSchema = z.object({
  instanceId: z.string(),
  taskId: z.string(),
  formData: z.record(z.unknown()),
  buttonField: z.string().optional(),
})

const approveSchema = z.object({
  instanceId: z.string(),
  taskId: z.string(),
  formData: z.record(z.unknown()).optional(),
  comment: z.string().optional(),
})

const rejectSchema = z.object({
  instanceId: z.string(),
  taskId: z.string(),
  comment: z.string().optional(),
})

// ── POST /api/flow-actions/submit ──

router.post('/submit', requireAuth, validate(submitSchema), async (ctx) => {
  const { instanceId, taskId, formData, buttonField } = ctx.request.body as {
    instanceId: string
    taskId: string
    formData: Record<string, unknown>
    buttonField?: string
  }
  const userId = ctx.state.user.id

  // 1. 查找任务
  const task = await TaskInstanceModel.findById(taskId)
  if (!task || task.instanceId !== instanceId) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Task not found' } }
    return
  }

  // 2. 验证任务状态
  if (task.status !== 'pending' && task.status !== 'claimed') {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Task already completed' } }
    return
  }

  // 3. 更新表单数据
  task.formData = formData
  task.status = 'completed'
  task.outcome = 'submitted'
  await task.save()

  // 4. 查找流程实例
  const instance = await FlowInstanceModel.findById(instanceId)
  if (!instance) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Instance not found' } }
    return
  }

  // 5. 推进流程
  try {
    const engine = new FlowEngine()
    await engine.advance(instanceId)

    // 6. Socket 通知
    await notifyNextTasks(instance, task.nodeId)

    ctx.body = { success: true, data: { taskId, status: 'completed' } }
  } catch (err) {
    logger.error({ msg: '[flow-action] submit error', error: err })
    ctx.status = 500
    ctx.body = { success: false, error: { message: 'Failed to advance flow' } }
  }
})

// ── POST /api/flow-actions/approve ──

router.post('/approve', requireAuth, validate(approveSchema), async (ctx) => {
  const { instanceId, taskId, formData, comment } = ctx.request.body as {
    instanceId: string
    taskId: string
    formData?: Record<string, unknown>
    comment?: string
  }
  const userId = ctx.state.user.id

  const task = await TaskInstanceModel.findById(taskId)
  if (!task || task.instanceId !== instanceId) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Task not found' } }
    return
  }

  if (task.status !== 'pending' && task.status !== 'claimed') {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Task already completed' } }
    return
  }

  // 更新任务
  task.formData = { ...task.formData, ...formData }
  task.status = 'completed'
  task.outcome = 'approved'
  await task.save()

  // 记录审批日志
  const { ApprovalLogModel } = await import('../flow-models/ApprovalLog.js')
  await ApprovalLogModel.create({
    _id: uuidv4(),
    tenantId: task.tenantId,
    instanceId,
    taskId,
    nodeId: task.nodeId,
    action: 'approve',
    userId,
    comment,
  })

  // 推进流程
  const instance = await FlowInstanceModel.findById(instanceId)
  if (!instance) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Instance not found' } }
    return
  }

  try {
    const engine = new FlowEngine()
    await engine.advance(instanceId)
    await notifyNextTasks(instance, task.nodeId)

    ctx.body = { success: true, data: { taskId, outcome: 'approved' } }
  } catch (err) {
    logger.error({ msg: '[flow-action] approve error', error: err })
    ctx.status = 500
    ctx.body = { success: false, error: { message: 'Failed to advance flow' } }
  }
})

// ── POST /api/flow-actions/reject ──

router.post('/reject', requireAuth, validate(rejectSchema), async (ctx) => {
  const { instanceId, taskId, comment } = ctx.request.body as {
    instanceId: string
    taskId: string
    comment?: string
  }
  const userId = ctx.state.user.id

  const task = await TaskInstanceModel.findById(taskId)
  if (!task || task.instanceId !== instanceId) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Task not found' } }
    return
  }

  if (task.status !== 'pending' && task.status !== 'claimed') {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Task already completed' } }
    return
  }

  task.status = 'completed'
  task.outcome = 'rejected'
  await task.save()

  // 记录审批日志
  const { ApprovalLogModel } = await import('../flow-models/ApprovalLog.js')
  await ApprovalLogModel.create({
    _id: uuidv4(),
    tenantId: task.tenantId,
    instanceId,
    taskId,
    nodeId: task.nodeId,
    action: 'reject',
    userId,
    comment,
  })

  // 推进流程
  const instance = await FlowInstanceModel.findById(instanceId)
  if (!instance) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Instance not found' } }
    return
  }

  try {
    const engine = new FlowEngine()
    await engine.advance(instanceId)
    await notifyNextTasks(instance, task.nodeId)

    ctx.body = { success: true, data: { taskId, outcome: 'rejected' } }
  } catch (err) {
    logger.error({ msg: '[flow-action] reject error', error: err })
    ctx.status = 500
    ctx.body = { success: false, error: { message: 'Failed to advance flow' } }
  }
})

// ── Helpers ──

/**
 * 通知下一个节点的任务负责人
 */
async function notifyNextTasks(instance: Record<string, unknown>, currentNodeId: string) {
  const tasks = await TaskInstanceModel.find({
    instanceId: instance._id,
    status: 'pending',
  })

  for (const task of tasks) {
    if (task.assignee) {
      socketService.emitToUser(task.assignee, 'flow:task-assigned', {
        taskId: task._id,
        instanceId: instance._id,
        nodeId: task.nodeId,
        nodeName: task.nodeName,
        formSchemaId: task.formSchemaId,
        formPublishId: task.formPublishId,
      })
    }

    // 通知候选用户
    for (const userId of (task.candidateUsers || [])) {
      socketService.emitToUser(userId, 'flow:task-available', {
        taskId: task._id,
        instanceId: instance._id,
        nodeId: task.nodeId,
        nodeName: task.nodeName,
      })
    }
  }
}

export default router
