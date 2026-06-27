/**
 * Dashboard statistics API.
 *
 * GET /api/stats                — Aggregate platform stats (schemas, flows, AI, activity)
 * GET /api/stats/conversations  — Recent AI conversations for the dashboard
 */

import Router from '@koa/router'
import { FormSchemaModel } from '../models/FormSchema.js'
import { PublishedSchemaModel } from '../models/PublishedSchema.js'
import { FlowDefinitionModel } from '../flow-models/FlowDefinition.js'
import { FlowInstanceModel } from '../flow-models/FlowInstance.js'
import { AIConversationModel } from '../ai/services/conversationService.js'
import { authMiddleware } from '../middleware/auth.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/stats' })

// ────────────────────────────────────────────
// GET /api/stats
// ────────────────────────────────────────────

router.get('/', requireAuth, async (ctx) => {
  const [
    totalSchemas,
    publishedSchemas,
    totalFlows,
    runningInstances,
    completedInstances,
    totalConversations,
  ] = await Promise.all([
    FormSchemaModel.countDocuments(),
    PublishedSchemaModel.countDocuments(),
    FlowDefinitionModel.countDocuments(),
    FlowInstanceModel.countDocuments({ status: 'running' }),
    FlowInstanceModel.countDocuments({ status: 'completed' }),
    AIConversationModel.countDocuments(),
  ])

  // Estimate AI token usage from conversation message content length.
  // Approximate: 1 token ~= 4 characters (English) / 2 characters (CJK).
  // We use a conservative 3 chars/token average.
  const tokenAgg = await AIConversationModel.aggregate<{
    totalChars: number
  }>([
    { $unwind: '$messages' },
    {
      $group: {
        _id: null,
        totalChars: { $sum: { $strLenCP: { $ifNull: ['$messages.content', ''] } } },
      },
    },
  ])
  const estimatedTokens = tokenAgg.length > 0
    ? Math.round(tokenAgg[0].totalChars / 3)
    : 0

  // AI success rate: conversations with at least one assistant message
  // (meaning the model responded successfully) vs total conversations.
  const successfulConversations = await AIConversationModel.countDocuments({
    'messages.role': 'assistant',
  })
  const aiSuccessRate = totalConversations > 0
    ? Math.round((successfulConversations / totalConversations) * 100) / 100
    : 0

  ctx.body = {
    success: true,
    data: {
      schemas: {
        total: totalSchemas,
        published: publishedSchemas,
        draft: totalSchemas, // FormSchema only holds drafts
      },
      flows: {
        total: totalFlows,
        running: runningInstances,
        completed: completedInstances,
      },
      ai: {
        total: totalConversations,
        tokenUsage: estimatedTokens,
        successRate: aiSuccessRate,
      },
      // No session/visit tracking implemented yet — return schema placeholders
      userActivity: {
        onlineUsers: 0,
        todayVisits: 0,
      },
    },
  }
})

// ────────────────────────────────────────────
// GET /api/stats/conversations
// ────────────────────────────────────────────

router.get('/conversations', requireAuth, async (ctx) => {
  const limit = Math.min(Math.max(Number(ctx.query.limit) || 10, 1), 50)

  const conversations = await AIConversationModel.find()
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean()

  const data = conversations.map((c) => {
    const messageCount = c.messages?.length ?? 0

    // Estimate token usage per conversation from message content length
    const totalChars = c.messages?.reduce(
      (sum: number, m: { content?: string }) => sum + (m.content?.length ?? 0),
      0,
    ) ?? 0
    const tokenUsage = Math.round(totalChars / 3)

    // Derive title from first user message
    const firstUserMsg = c.messages?.find((m: { role: string }) => m.role === 'user')
    const title = firstUserMsg?.content?.slice(0, 50) || 'New conversation'

    // Map source to agentType label
    const agentType = c.activeAgent ?? c.source ?? 'auto'

    // Determine status: if last message is from assistant, it's completed
    const lastMessage = c.messages?.[c.messages.length - 1]
    const status = lastMessage?.role === 'assistant' ? 'completed' : 'active'

    return {
      id: c._id,
      title,
      agentType,
      messageCount,
      tokenUsage,
      status,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }
  })

  ctx.body = {
    success: true,
    data,
  }
})

export default router
