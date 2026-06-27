/**
 * Flow 路由 — 流程定义、实例、任务管理
 *
 * 三项目关联：
 * - Editor: 通过 /instances/:id/graph 和 /instances/:id/state 获取流程图和执行状态
 * - Flow: 通过 FlowEngine 执行流程
 * - AI: 通过 /tasks 和 /instances 获取数据进行分析
 */
import Router from '@koa/router'
import { v4 as uuidv4 } from 'uuid'
import { authMiddleware } from '../middleware/auth.js'
import { FlowDefinitionModel } from '../models/FlowDefinition.js'
import { flowPersistence } from '../services/flowPersistence.js'
import { seedFlowData } from '../services/flowTestData.js'
import { FlowEngine } from '@schema-form/flow-shared'

const requireAuth = authMiddleware({ required: true })

// 创建 FlowEngine 单例
const flowEngine = new FlowEngine({
  persistence: flowPersistence,
  callbacks: {
    onTaskCreated: (task) => {
      console.log(`[Flow] Task created: ${task.id} (${task.nodeName})`)
    },
    onFlowComplete: (instance) => {
      console.log(`[Flow] Instance completed: ${instance.id}`)
    },
    onFlowError: (instanceId, error) => {
      console.error(`[Flow] Instance error: ${instanceId} - ${error}`)
    },
  },
})

const router = new Router({ prefix: '/api/flow' })

// ────── 流程定义 ──────

/**
 * 获取流程定义列表
 */
router.get('/definitions', requireAuth, async (ctx) => {
  const { page = '1', pageSize = '20', status, keyword } = ctx.query
  const pageNum = parseInt(page as string, 10)
  const pageSizeNum = parseInt(pageSize as string, 10)

  const filter: Record<string, unknown> = {}
  if (status) filter.status = status
  if (keyword) {
    filter.$or = [
      { name: { $regex: keyword, $options: 'i' } },
      { description: { $regex: keyword, $options: 'i' } },
    ]
  }

  const [items, total] = await Promise.all([
    FlowDefinitionModel.find(filter)
      .sort({ updatedAt: -1 })
      .skip((pageNum - 1) * pageSizeNum)
      .limit(pageSizeNum)
      .lean(),
    FlowDefinitionModel.countDocuments(filter),
  ])

  ctx.body = { items, total }
})

/**
 * 获取流程定义详情
 */
router.get('/definitions/:id', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const doc = await FlowDefinitionModel.findOne({ id }).lean()
  if (!doc) {
    ctx.status = 404
    ctx.body = { error: 'Not found' }
    return
  }
  ctx.body = doc
})

/**
 * 创建流程定义
 */
router.post('/definitions', requireAuth, async (ctx) => {
  const body = ctx.request.body as any
  const definition = new FlowDefinitionModel({
    id: uuidv4(),
    name: body.name ?? 'Untitled',
    description: body.description,
    graph: body.graph ?? { nodes: [], edges: [] },
    version: 1,
    status: 'draft',
  })
  await definition.save()
  ctx.body = definition.toObject()
})

/**
 * 更新流程定义
 */
router.put('/definitions/:id', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as any

  const doc = await FlowDefinitionModel.findOneAndUpdate(
    { id },
    { $set: { ...body, updatedAt: new Date() } },
    { new: true },
  ).lean()

  if (!doc) {
    ctx.status = 404
    ctx.body = { error: 'Not found' }
    return
  }
  ctx.body = doc
})

/**
 * 删除流程定义
 */
router.delete('/definitions/:id', requireAuth, async (ctx) => {
  const { id } = ctx.params
  await FlowDefinitionModel.deleteOne({ id })
  ctx.status = 204
})

// ────── 流程实例 ──────

/**
 * 启动流程实例
 */
router.post('/instances', requireAuth, async (ctx) => {
  const { definitionId, variables } = ctx.request.body as any
  const user = ctx.state.user

  try {
    const instance = await flowEngine.startInstance(
      definitionId,
      variables ?? {},
      user?.id ?? 'anonymous',
    )
    ctx.body = instance
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { error: err.message }
  }
})

/**
 * 获取流程实例列表
 */
router.get('/instances', requireAuth, async (ctx) => {
  const { page = '1', pageSize = '20', status, definitionId } = ctx.query
  const result = await flowPersistence.listInstances({
    page: parseInt(page as string, 10),
    pageSize: parseInt(pageSize as string, 10),
    status: status as string,
    definitionId: definitionId as string,
  })
  ctx.body = result
})

/**
 * 获取流程实例详情
 */
router.get('/instances/:id', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const instance = await flowPersistence.getInstance(id)
  if (!instance) {
    ctx.status = 404
    ctx.body = { error: 'Not found' }
    return
  }
  ctx.body = instance
})

/**
 * 取消流程实例
 */
router.post('/instances/:id/cancel', requireAuth, async (ctx) => {
  const { id } = ctx.params
  await flowPersistence.updateInstance(id, {
    status: 'terminated',
    completedAt: new Date(),
  })
  const instance = await flowPersistence.getInstance(id)
  ctx.body = instance
})

/**
 * 获取流程实例的流程图（供 Editor 嵌入预览）
 */
router.get('/instances/:id/graph', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const graph = await flowEngine.getFlowGraph(id)
  if (!graph) {
    ctx.status = 404
    ctx.body = { error: 'Not found' }
    return
  }
  ctx.body = graph
})

/**
 * 获取流程实例的执行状态（供 Editor 高亮节点）
 */
router.get('/instances/:id/state', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const state = await flowEngine.getExecutionState(id)
  ctx.body = state
})

/**
 * 获取流程实例的审批日志
 */
router.get('/instances/:id/logs', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const logs = await flowEngine.getApprovalLogs(id)
  ctx.body = logs
})

// ────── 任务 ──────

/**
 * 获取我的待办任务
 */
router.get('/tasks', requireAuth, async (ctx) => {
  const { page = '1', pageSize = '20', status, search } = ctx.query
  const user = ctx.state.user

  const result = await flowPersistence.listTasks({
    page: parseInt(page as string, 10),
    pageSize: parseInt(pageSize as string, 10),
    assignee: user?.id,
    status: status as string,
    search: search as string,
  })
  ctx.body = result
})

/**
 * 获取任务详情
 */
router.get('/tasks/:id', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const task = await flowPersistence.getTask(id)
  if (!task) {
    ctx.status = 404
    ctx.body = { error: 'Not found' }
    return
  }
  ctx.body = task
})

/**
 * 认领任务
 */
router.post('/tasks/:id/claim', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const user = ctx.state.user

  try {
    const task = await flowEngine.claimTask(id, user?.id ?? 'anonymous')
    ctx.body = task
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { error: err.message }
  }
})

/**
 * 审批通过
 */
router.post('/tasks/:id/approve', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const { formData, comment } = ctx.request.body as any
  const user = ctx.state.user

  try {
    await flowEngine.approveTask(id, 'approve', formData, comment, user?.id)
    const task = await flowPersistence.getTask(id)
    ctx.body = task
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { error: err.message }
  }
})

/**
 * 审批驳回
 */
router.post('/tasks/:id/reject', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const { formData, comment } = ctx.request.body as any
  const user = ctx.state.user

  try {
    await flowEngine.approveTask(id, 'reject', formData, comment, user?.id)
    const task = await flowPersistence.getTask(id)
    ctx.body = task
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { error: err.message }
  }
})

/**
 * 驳回到指定节点
 */
router.post('/tasks/:id/reject-to-node', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const { targetNodeId, comment } = ctx.request.body as any
  const user = ctx.state.user

  try {
    await flowEngine.rejectToNode(id, targetNodeId, comment, user?.id)
    const task = await flowPersistence.getTask(id)
    ctx.body = task
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { error: err.message }
  }
})

/**
 * 委派任务
 */
router.post('/tasks/:id/delegate', requireAuth, async (ctx) => {
  const { id } = ctx.params
  const { assignee, comment } = ctx.request.body as any
  const user = ctx.state.user

  try {
    const task = await flowEngine.delegateTask(id, assignee, comment, user?.id)
    ctx.body = task
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { error: err.message }
  }
})

/**
 * 获取驳回目标节点列表
 */
router.get('/tasks/:id/reject-targets', requireAuth, async (ctx) => {
  const { id } = ctx.params

  try {
    const targets = await flowEngine.getRejectTargets(id)
    ctx.body = targets
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { error: err.message }
  }
})

/**
 * 种子数据（开发环境）
 */
router.post('/seed', requireAuth, async (ctx) => {
  try {
    const result = await seedFlowData()
    ctx.body = {
      message: 'Flow seed data created',
      ...result,
    }
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})

export default router
