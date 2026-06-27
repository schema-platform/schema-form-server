import Router from '@koa/router'
import { validate as uuidValidate } from 'uuid'
import { FlowInstanceModel } from '../flow-models/FlowInstance.js'
import { FlowDefinitionModel } from '../flow-models/FlowDefinition.js'
import { authMiddleware, type JwtPayload } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { dataScopeMiddleware } from '../middleware/dataScope.js'
import { validate } from '../middleware/validate.js'
import { startInstanceSchema } from '../flow-schemas/instanceSchemas.js'
import { flowEngine } from '../flow-services/FlowEngine.js'
import { flowPermissionService } from '../flow-services/FlowPermissionService.js'

const requireAuth = authMiddleware({ required: true })
const dataScope = dataScopeMiddleware()
const requireFlowStart = requirePermission('flow:start')
const requireFlowView = requirePermission('flow:view')

const router = new Router({ prefix: '/api/flow-instances' })

// GET /api/flow-instances/stats — 实例状态统计（支持时间范围筛选）
router.get('/stats', requireAuth, requireFlowView, dataScope, async (ctx) => {
  const { preset, startDate, endDate } = ctx.query as {
    preset?: string; startDate?: string; endDate?: string
  }

  const match: Record<string, unknown> = {}
  if (preset && preset !== 'all') {
    const now = new Date()
    let from: Date
    let to: Date

    if (preset === 'today') {
      from = new Date(now); from.setHours(0, 0, 0, 0); to = now
    } else if (preset === 'week') {
      from = new Date(now); from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0); to = now
    } else if (preset === 'month') {
      from = new Date(now); from.setMonth(from.getMonth() - 1); from.setHours(0, 0, 0, 0); to = now
    } else if (preset === 'custom' && startDate) {
      from = new Date(startDate); from.setHours(0, 0, 0, 0)
      to = endDate ? new Date(endDate) : now; to.setHours(23, 59, 59, 999)
    } else {
      from = new Date(0); to = now
    }
    match.createdAt = { $gte: from, $lte: to }
  }

  // Apply data_scope filter
  const applyDataScope = ctx.state.applyDataScope as (
    base: Record<string, unknown>,
    ownerField: string,
  ) => Promise<Record<string, unknown>>
  const scopedMatch = await applyDataScope(match, 'initiatedBy')

  const matchStage = Object.keys(scopedMatch).length > 0 ? { $match: scopedMatch } : undefined

  const pipeline = [
    ...(matchStage ? [matchStage] : []),
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]

  const stats = await FlowInstanceModel.aggregate(pipeline)
  const statusMap = new Map(stats.map((s) => [s._id, s.count]))
  const total = stats.reduce((sum, s) => sum + s.count, 0)
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0)

  const running = statusMap.get('running') ?? 0
  const completed = statusMap.get('completed') ?? 0
  const terminated = statusMap.get('terminated') ?? 0
  const suspended = statusMap.get('suspended') ?? 0
  const failed = statusMap.get('failed') ?? 0

  ctx.body = {
    success: true,
    data: {
      total,
      running,
      completed,
      terminated,
      suspended,
      failed,
      runningPct: pct(running),
      completedPct: pct(completed),
      terminatedPct: pct(terminated),
      suspendedPct: pct(suspended),
      failedPct: pct(failed),
    },
  }
})

// GET /api/flow-instances
router.get('/', requireAuth, requireFlowView, dataScope, async (ctx) => {
  const { definitionId, status, search, page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query
  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (definitionId && uuidValidate(definitionId as string)) filter.definitionId = definitionId
  if (
    status &&
    ['running', 'completed', 'terminated', 'suspended', 'failed'].includes(status as string)
  ) {
    filter.status = status
  }

  // Search by definition name or initiatedBy
  if (search) {
    const escaped = (search as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matchingDefs = await FlowDefinitionModel.find(
      { name: { $regex: escaped, $options: 'i' } },
      { _id: 1 },
    )
    const matchingDefIds = matchingDefs.map((d) => d._id)
    filter.$or = [
      { definitionId: { $in: matchingDefIds } },
      { initiatedBy: { $regex: escaped, $options: 'i' } },
    ]
  }

  // Apply data_scope filter
  const applyDataScope = ctx.state.applyDataScope as (
    base: Record<string, unknown>,
    ownerField: string,
  ) => Promise<Record<string, unknown>>
  const scopedFilter = await applyDataScope(filter, 'initiatedBy')

  const [items, total] = await Promise.all([
    FlowInstanceModel.find(scopedFilter).skip(skip).limit(pageSize).sort({ createdAt: -1 }),
    FlowInstanceModel.countDocuments(scopedFilter),
  ])

  // Batch-fetch flow definition names
  const definitionIds = [...new Set(items.map((i) => i.definitionId))]
  const definitions = await FlowDefinitionModel.find(
    { _id: { $in: definitionIds } },
    { name: 1 },
  )
  const nameMap = new Map(definitions.map((d) => [d._id, d.name]))

  const enriched = items.map((item) => ({
    ...item.toJSON(),
    definitionName: nameMap.get(item.definitionId) ?? null,
  }))

  ctx.body = {
    success: true,
    data: { items: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  }
})

// POST /api/flow-instances
router.post('/', requireAuth, requireFlowStart, validate(startInstanceSchema), async (ctx) => {
  const { definitionId, variables } = ctx.request.body as {
    definitionId: string
    variables?: Record<string, unknown>
  }

  const userId = (ctx.state.user as { id: string }).id

  const canLaunch = await flowPermissionService.checkLaunchPermission(userId, definitionId)
  if (!canLaunch) {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'You do not have permission to launch this flow.' } }
    return
  }

  const instance = await flowEngine.startFlow(definitionId, variables ?? {}, userId)

  ctx.status = 201
  ctx.body = { success: true, data: instance }
})

// GET /api/flow-instances/:id
router.get('/:id', requireAuth, requireFlowView, async (ctx) => {
  const { id } = ctx.params
  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const instance = await FlowInstanceModel.findById(id)
  if (!instance) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Instance not found.' } }
    return
  }

  ctx.body = { success: true, data: instance }
})

// POST /api/flow-instances/:id/terminate
router.post('/:id/terminate', requireAuth, async (ctx) => {
  const { id } = ctx.params
  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  await flowEngine.terminateInstance(id)
  const instance = await FlowInstanceModel.findById(id)
  ctx.body = { success: true, data: instance }
})

// POST /api/flow-instances/:id/suspend
router.post('/:id/suspend', requireAuth, async (ctx) => {
  const { id } = ctx.params
  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  await flowEngine.suspendInstance(id)
  const instance = await FlowInstanceModel.findById(id)
  ctx.body = { success: true, data: instance }
})

// POST /api/flow-instances/:id/resume
router.post('/:id/resume', requireAuth, async (ctx) => {
  const { id } = ctx.params
  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  await flowEngine.resumeInstance(id)
  const instance = await FlowInstanceModel.findById(id)
  ctx.body = { success: true, data: instance }
})

export default router
