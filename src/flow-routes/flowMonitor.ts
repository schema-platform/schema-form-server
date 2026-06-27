import Router from '@koa/router'
import { FlowInstanceModel } from '../flow-models/FlowInstance.js'
import { TaskInstanceModel } from '../flow-models/TaskInstance.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'

const requireAuth = authMiddleware({ required: true })
const requireFlowMonitor = requirePermission('flow:monitor')

/** 根据 preset 或自定义日期范围构建 createdAt 的 $match 条件 */
function buildDateMatch(ctx: { query: Record<string, unknown> }) {
  const { preset, startDate, endDate } = ctx.query as {
    preset?: string
    startDate?: string
    endDate?: string
  }

  if (!preset || preset === 'all') return {}

  const now = new Date()
  let from: Date
  let to: Date

  switch (preset) {
    case 'today': {
      from = new Date(now)
      from.setHours(0, 0, 0, 0)
      to = now
      break
    }
    case 'week': {
      from = new Date(now)
      from.setDate(from.getDate() - 7)
      from.setHours(0, 0, 0, 0)
      to = now
      break
    }
    case 'month': {
      from = new Date(now)
      from.setMonth(from.getMonth() - 1)
      from.setHours(0, 0, 0, 0)
      to = now
      break
    }
    case 'custom': {
      if (!startDate) return {}
      from = new Date(startDate)
      from.setHours(0, 0, 0, 0)
      to = endDate ? new Date(endDate) : now
      to.setHours(23, 59, 59, 999)
      break
    }
    default:
      return {}
  }

  return { createdAt: { $gte: from, $lte: to } }
}

const router = new Router({ prefix: '/api/flow-monitor' })

// GET /api/flow-monitor/stats — 按状态分组的实例统计（支持时间范围筛选）
router.get('/stats', requireAuth, requireFlowMonitor, async (ctx) => {
  const dateMatch = buildDateMatch(ctx)
  const matchStage = Object.keys(dateMatch).length > 0 ? { $match: dateMatch } : undefined

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

// GET /api/flow-monitor/avg-duration — 已完成实例的平均时长（毫秒）
router.get('/avg-duration', requireAuth, requireFlowMonitor, async (ctx) => {
  const result = await FlowInstanceModel.aggregate([
    { $match: { status: 'completed', completedAt: { $ne: null } } },
    {
      $project: {
        duration: { $subtract: ['$completedAt', '$startedAt'] },
      },
    },
    { $group: { _id: null, avgDuration: { $avg: '$duration' } } },
  ])

  ctx.body = {
    success: true,
    data: { avgDuration: Math.round(result[0]?.avgDuration ?? 0) },
  }
})

// GET /api/flow-monitor/node-stats — 各节点的完成次数和平均耗时
router.get('/node-stats', requireAuth, requireFlowMonitor, async (ctx) => {
  const stats = await TaskInstanceModel.aggregate([
    { $match: { status: 'completed' } },
    {
      $project: {
        nodeId: 1,
        nodeName: 1,
        duration: { $subtract: ['$updatedAt', '$createdAt'] },
      },
    },
    {
      $group: {
        _id: '$nodeId',
        nodeName: { $first: '$nodeName' },
        count: { $sum: 1 },
        avgDuration: { $avg: '$duration' },
      },
    },
    { $sort: { count: -1 } },
    {
      $project: {
        _id: 0,
        nodeId: '$_id',
        nodeName: 1,
        count: 1,
        avgDuration: { $round: ['$avgDuration', 0] },
      },
    },
  ])

  ctx.body = { success: true, data: stats }
})

// GET /api/flow-monitor/trend — 按天统计实例创建趋势（支持时间范围筛选）
router.get('/trend', requireAuth, requireFlowMonitor, async (ctx) => {
  const { days: daysStr = '30', preset, startDate: customStart, endDate: customEnd } = ctx.query as {
    days?: string; preset?: string; startDate?: string; endDate?: string
  }

  let from: Date
  let to: Date

  if (preset === 'today') {
    from = new Date()
    from.setHours(0, 0, 0, 0)
    to = new Date()
  } else if (preset === 'week') {
    from = new Date()
    from.setDate(from.getDate() - 7)
    from.setHours(0, 0, 0, 0)
    to = new Date()
  } else if (preset === 'month') {
    from = new Date()
    from.setMonth(from.getMonth() - 1)
    from.setHours(0, 0, 0, 0)
    to = new Date()
  } else if (preset === 'custom' && customStart) {
    from = new Date(customStart)
    from.setHours(0, 0, 0, 0)
    to = customEnd ? new Date(customEnd) : new Date()
    to.setHours(23, 59, 59, 999)
  } else {
    const days = Math.min(365, Math.max(1, parseInt(daysStr as string, 10) || 30))
    from = new Date()
    from.setDate(from.getDate() - days)
    from.setHours(0, 0, 0, 0)
    to = new Date()
  }

  const trend = await FlowInstanceModel.aggregate([
    { $match: { createdAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        date: '$_id',
        count: 1,
      },
    },
  ])

  // 填充没有数据的日期为 0
  const result: Array<{ date: string; count: number }> = []
  const trendMap = new Map(trend.map((t) => [t.date, t.count]))
  const cursor = new Date(from)
  const today = new Date(to)
  today.setHours(0, 0, 0, 0)

  while (cursor <= today) {
    const dateStr = cursor.toISOString().slice(0, 10)
    result.push({ date: dateStr, count: trendMap.get(dateStr) ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }

  ctx.body = { success: true, data: result }
})

// GET /api/flow-monitor/top-flows — 按实例数排名的热门流程 Top N
router.get('/top-flows', requireAuth, requireFlowMonitor, async (ctx) => {
  const { limit: limitStr = '5' } = ctx.query
  const limit = Math.min(20, Math.max(1, parseInt(limitStr as string, 10) || 5))

  const topFlows = await FlowInstanceModel.aggregate([
    { $group: { _id: '$definitionId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'flowdefinitions',
        localField: '_id',
        foreignField: '_id',
        as: 'definition',
      },
    },
    {
      $project: {
        _id: 0,
        definitionId: '$_id',
        flowName: { $ifNull: [{ $arrayElemAt: ['$definition.name', 0] }, '$_id'] },
        count: 1,
      },
    },
  ])

  ctx.body = { success: true, data: topFlows }
})

export default router
