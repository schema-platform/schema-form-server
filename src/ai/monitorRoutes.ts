/**
 * Agent Performance Monitoring Routes.
 *
 * GET /api/ai/monitor/stats   — Agent performance statistics
 * GET /api/ai/monitor/recent  — Recent agent metrics
 * GET /api/ai/monitor/alerts  — Performance alerts (slow operations, failures)
 * GET /api/ai/monitor/summary — Quick summary of agent performance
 */

import Router from '@koa/router'
import { AgentMetricModel } from './models/monitor.js'
import { authMiddleware } from '../middleware/auth.js'

const router = new Router({ prefix: '/api/ai/monitor' })

// All monitor routes require authentication
router.use(authMiddleware())

// ────────────────────────────────────────────
// GET /api/ai/monitor/stats — Agent performance statistics
// ────────────────────────────────────────────

/**
 * Query params:
 * - agentName: Filter by agent name (thinker, editor, flow, general, summarizer)
 * - operation: Filter by operation type (invoke, tool_call, think, stream)
 * - startDate: Start date for time range filter (ISO 8601)
 * - endDate: End date for time range filter (ISO 8601)
 */
router.get('/stats', async (ctx) => {
  const { agentName, operation, startDate, endDate } = ctx.query as {
    agentName?: string
    operation?: string
    startDate?: string
    endDate?: string
  }

  const matchStage: Record<string, unknown> = {}
  if (agentName) matchStage.agentName = agentName
  if (operation) matchStage.operation = operation
  if (startDate || endDate) {
    matchStage.createdAt = {}
    if (startDate) (matchStage.createdAt as Record<string, Date>).$gte = new Date(startDate)
    if (endDate) (matchStage.createdAt as Record<string, Date>).$lte = new Date(endDate)
  }

  const stats = await AgentMetricModel.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          agentName: '$agentName',
          operation: '$operation',
        },
        avgDuration: { $avg: '$duration' },
        minDuration: { $min: '$duration' },
        maxDuration: { $max: '$duration' },
        durations: { $push: '$duration' },
        successRate: {
          $avg: { $cond: ['$success', 1, 0] },
        },
        totalCalls: { $sum: 1 },
        successCount: {
          $sum: { $cond: ['$success', 1, 0] },
        },
        failureCount: {
          $sum: { $cond: ['$success', 0, 1] },
        },
        totalTokens: {
          $sum: { $ifNull: ['$tokenUsage.total', 0] },
        },
        avgTokens: {
          $avg: { $ifNull: ['$tokenUsage.total', 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        agentName: '$_id.agentName',
        operation: '$_id.operation',
        avgDuration: { $round: ['$avgDuration', 2] },
        minDuration: 1,
        maxDuration: 1,
        p95Duration: {
          $let: {
            vars: {
              sorted: { $sortArray: { input: '$durations', sortBy: 1 } },
              count: { $size: '$durations' },
            },
            in: {
              $arrayElemAt: [
                '$$sorted',
                { $subtract: [{ $ceil: { $multiply: ['$$count', 0.95] } }, 1] },
              ],
            },
          },
        },
        successRate: { $round: [{ $multiply: ['$successRate', 100] }, 2] },
        totalCalls: 1,
        successCount: 1,
        failureCount: 1,
        totalTokens: 1,
        avgTokens: { $round: ['$avgTokens', 2] },
      },
    },
    { $sort: { agentName: 1, operation: 1 } },
  ])

  ctx.body = {
    success: true,
    data: stats,
  }
})

// ────────────────────────────────────────────
// GET /api/ai/monitor/recent — Recent agent metrics
// ────────────────────────────────────────────

/**
 * Query params:
 * - limit: Number of records to return (default 50, max 200)
 * - agentName: Filter by agent name
 * - success: Filter by success status (true/false)
 */
router.get('/recent', async (ctx) => {
  const { limit: limitStr, agentName, success: successStr } = ctx.query as {
    limit?: string
    agentName?: string
    success?: string
  }

  const limit = Math.min(Math.max(parseInt(limitStr ?? '50', 10) || 50, 1), 200)
  const filter: Record<string, unknown> = {}

  if (agentName) filter.agentName = agentName
  if (successStr !== undefined) filter.success = successStr === 'true'

  const metrics = await AgentMetricModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()

  ctx.body = {
    success: true,
    data: metrics.map((m) => ({
      id: m._id,
      agentName: m.agentName,
      operation: m.operation,
      duration: m.duration,
      success: m.success,
      error: m.error,
      tokenUsage: m.tokenUsage,
      metadata: m.metadata,
      createdAt: m.createdAt,
    })),
  }
})

// ────────────────────────────────────────────
// GET /api/ai/monitor/alerts — Performance alerts
// ────────────────────────────────────────────

/**
 * Returns metrics that indicate potential issues:
 * - Slow operations (duration > threshold)
 * - Failed operations
 * - High token usage
 *
 * Query params:
 * - threshold: Duration threshold in ms for slow operations (default 10000)
 * - limit: Number of alerts to return (default 20)
 */
router.get('/alerts', async (ctx) => {
  const { threshold: thresholdStr, limit: limitStr } = ctx.query as {
    threshold?: string
    limit?: string
  }

  const threshold = parseInt(thresholdStr ?? '10000', 10) || 10000
  const limit = Math.min(Math.max(parseInt(limitStr ?? '20', 10) || 20, 1), 100)

  const alerts = await AgentMetricModel.aggregate([
    {
      $match: {
        $or: [
          { success: false },
          { duration: { $gte: threshold } },
          { 'tokenUsage.total': { $gte: 10000 } },
        ],
      },
    },
    {
      $addFields: {
        alertType: {
          $switch: {
            branches: [
              { case: { $eq: ['$success', false] }, then: 'failure' },
              { case: { $gte: ['$duration', threshold] }, then: 'slow' },
              { case: { $gte: ['$tokenUsage.total', 10000] }, then: 'high_token' },
            ],
            default: 'unknown',
          },
        },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        id: '$_id',
        agentName: 1,
        operation: 1,
        duration: 1,
        success: 1,
        error: 1,
        tokenUsage: 1,
        alertType: 1,
        createdAt: 1,
      },
    },
  ])

  ctx.body = {
    success: true,
    data: alerts,
  }
})

// ────────────────────────────────────────────
// GET /api/ai/monitor/summary — Quick summary of agent performance
// ────────────────────────────────────────────

/**
 * Returns high-level metrics for dashboard display.
 *
 * Query params:
 * - hours: Time window in hours (default 24)
 */
router.get('/summary', async (ctx) => {
  const { hours } = ctx.query as { hours?: string }
  const hoursNum = parseInt(hours ?? '24', 10) || 24
  const since = new Date(Date.now() - hoursNum * 60 * 60 * 1000)

  const [summary] = await AgentMetricModel.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        successCount: { $sum: { $cond: ['$success', 1, 0] } },
        failureCount: { $sum: { $cond: ['$success', 0, 1] } },
        avgDuration: { $avg: '$duration' },
        maxDuration: { $max: '$duration' },
        totalTokens: { $sum: { $ifNull: ['$tokenUsage.total', 0] } },
        slowCalls: {
          $sum: { $cond: [{ $gte: ['$duration', 10000] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        totalCalls: 1,
        successCount: 1,
        failureCount: 1,
        successRate: {
          $round: [
            { $multiply: [{ $divide: ['$successCount', { $max: ['$totalCalls', 1] }] }, 100] },
            2,
          ],
        },
        avgDuration: { $round: ['$avgDuration', 2] },
        maxDuration: 1,
        totalTokens: 1,
        slowCalls: 1,
        periodHours: hoursNum,
      },
    },
  ])

  ctx.body = {
    success: true,
    data: summary ?? {
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      avgDuration: 0,
      maxDuration: 0,
      totalTokens: 0,
      slowCalls: 0,
      periodHours: hoursNum,
    },
  }
})

export default router
