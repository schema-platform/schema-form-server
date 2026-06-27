/**
 * User behavior analysis service.
 *
 * Analyzes user behavior patterns to provide personalized recommendations.
 */

import { UserBehaviorModel } from '../../models/UserBehavior.js'
import { v4 as uuidv4 } from 'uuid'

interface BehaviorRecord {
  userId: string
  action: 'use_component' | 'set_property' | 'create_schema' | 'generate_ai'
  target?: string
  data?: Record<string, unknown>
}

interface UserPreferences {
  favoriteComponents: string[]
  commonProperties: string[]
  frequentActions: Array<{ action: string; count: number }>
  recentActivity: Array<{ action: string; target: string; timestamp: Date }>
}

/**
 * Record a user behavior event.
 */
export async function recordBehavior(record: BehaviorRecord): Promise<void> {
  await UserBehaviorModel.create({
    _id: uuidv4(),
    userId: record.userId,
    action: record.action,
    target: record.target ?? '',
    data: record.data ?? {},
  })
}

/**
 * Analyze user preferences from behavior history.
 */
export async function analyzeUserPreferences(userId: string): Promise<UserPreferences> {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // 并行查询各维度数据
  const [componentUsage, propertyUsage, actionCounts, recentActivity] = await Promise.all([
    // 常用组件 Top 10
    UserBehaviorModel.aggregate([
      {
        $match: {
          userId,
          action: 'use_component',
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      { $group: { _id: '$data.componentType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),

    // 常用属性配置 Top 10
    UserBehaviorModel.aggregate([
      {
        $match: {
          userId,
          action: 'set_property',
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      { $group: { _id: '$data.propertyKey', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),

    // 操作类型统计
    UserBehaviorModel.aggregate([
      {
        $match: {
          userId,
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    // 最近 20 条活动
    UserBehaviorModel.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('action target createdAt')
      .lean(),
  ])

  return {
    favoriteComponents: componentUsage.map((c) => c._id).filter(Boolean),
    commonProperties: propertyUsage.map((p) => p._id).filter(Boolean),
    frequentActions: actionCounts.map((a) => ({
      action: a._id,
      count: a.count,
    })),
    recentActivity: recentActivity.map((r) => ({
      action: r.action,
      target: r.target ?? '',
      timestamp: r.createdAt,
    })),
  }
}

/**
 * Build context string for AI agent with user preferences.
 */
export async function buildPreferencesContext(userId: string): Promise<string> {
  const preferences = await analyzeUserPreferences(userId)

  if (preferences.favoriteComponents.length === 0 && preferences.commonProperties.length === 0) {
    return ''
  }

  const lines: string[] = ['用户偏好：']

  if (preferences.favoriteComponents.length > 0) {
    lines.push(`- 常用组件：${preferences.favoriteComponents.join(', ')}`)
  }

  if (preferences.commonProperties.length > 0) {
    lines.push(`- 常用属性配置：${preferences.commonProperties.join(', ')}`)
  }

  return lines.join('\n')
}

/**
 * Get behavior statistics for a user.
 */
export async function getBehaviorStats(userId: string): Promise<{
  totalActions: number
  actionsByType: Record<string, number>
  dailyActivity: Array<{ date: string; count: number }>
}> {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [totalActions, actionsByType, dailyActivity] = await Promise.all([
    UserBehaviorModel.countDocuments({ userId, createdAt: { $gte: thirtyDaysAgo } }),

    UserBehaviorModel.aggregate([
      { $match: { userId, createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]),

    UserBehaviorModel.aggregate([
      { $match: { userId, createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ])

  const byType: Record<string, number> = {}
  for (const item of actionsByType) {
    byType[item._id] = item.count
  }

  return {
    totalActions,
    actionsByType: byType,
    dailyActivity: dailyActivity.map((d) => ({
      date: d._id,
      count: d.count,
    })),
  }
}
