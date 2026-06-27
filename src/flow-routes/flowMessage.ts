import Router from '@koa/router'
import { z } from 'zod'
import { authMiddleware } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { messageQueue } from '../flow-services/MessageQueue.js'
import { FlowMessageModel } from '../flow-models/FlowMessage.js'
import { TaskInstanceModel } from '../flow-models/TaskInstance.js'
import { flowEngine } from '../flow-services/FlowEngine.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/flow-messages' })

const sendMessageSchema = z.object({
  channel: z.string().min(1, 'Channel is required').max(200),
  payload: z.record(z.unknown()).default({}),
})

const completeMessageSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  data: z.record(z.unknown()).default({}),
})

// POST /api/flow-messages — send a message to a channel (external trigger)
router.post('/', requireAuth, validate(sendMessageSchema), async (ctx) => {
  const { channel, payload } = ctx.request.body as {
    channel: string
    payload: Record<string, unknown>
  }

  // Send via MessageQueue — this persists the message and notifies in-memory listeners
  const message = await messageQueue.send({
    channel,
    payload,
    senderInstanceId: 'external',
    senderNodeId: 'external',
  })

  ctx.status = 201
  ctx.body = { success: true, data: message }
})

// POST /api/flow-messages/complete — complete a ReceiveTask via message
router.post('/complete', requireAuth, validate(completeMessageSchema), async (ctx) => {
  const { taskId, data } = ctx.request.body as {
    taskId: string
    data: Record<string, unknown>
  }

  const task = await TaskInstanceModel.findById(taskId)
  if (!task) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Task not found.' } }
    return
  }

  if (task.status !== 'pending' && task.status !== 'claimed') {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Task is not in a completable state.' } }
    return
  }

  // Complete the task with the message data
  const userId = (ctx.state.user as { id: string }).id
  await flowEngine.completeTask(taskId, data, 'approved', userId)

  const updatedTask = await TaskInstanceModel.findById(taskId)
  ctx.body = { success: true, data: updatedTask }
})

// GET /api/flow-messages/pending/:channel — get pending messages for a channel
router.get('/pending/:channel', requireAuth, async (ctx) => {
  const { channel } = ctx.params
  const messages = await messageQueue.getPendingMessages(channel)
  ctx.body = { success: true, data: messages }
})

// GET /api/flow-messages/history — get message history with pagination
router.get('/history', requireAuth, async (ctx) => {
  const {
    channel,
    status,
    page: pageStr = '1',
    pageSize: pageSizeStr = '20',
  } = ctx.query

  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (channel) filter.channel = channel
  if (status && ['pending', 'consumed'].includes(status as string)) {
    filter.status = status
  }

  const [items, total] = await Promise.all([
    FlowMessageModel.find(filter).skip(skip).limit(pageSize).sort({ createdAt: -1 }),
    FlowMessageModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  }
})

export default router
