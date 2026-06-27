/**
 * Collaboration API Routes
 *
 * GET  /api/ai/collaboration/sessions          — List active sessions
 * GET  /api/ai/collaboration/sessions/:id      — Get session info
 * POST /api/ai/collaboration/sessions/:id/join  — Join session (HTTP fallback)
 * POST /api/ai/collaboration/sessions/:id/leave — Leave session (HTTP fallback)
 * GET  /api/ai/collaboration/conversations/:id/export — Export conversation as JSON
 */

import Router from '@koa/router'
import { authMiddleware } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { z } from 'zod'
import {
  getSessionInfo,
  getActiveSessions,
} from '../services/collaborationService.js'
import { getConversation } from '../services/conversationService.js'

const router = new Router({ prefix: '/api/ai/collaboration' })

// ────────────────────────────────────────────
// Validation schemas
// ────────────────────────────────────────────

const joinLeaveSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
}).strict()

// ────────────────────────────────────────────
// GET /api/ai/collaboration/sessions
// ────────────────────────────────────────────

router.get('/sessions', async (ctx) => {
  const sessions = getActiveSessions()

  ctx.body = {
    success: true,
    data: sessions,
  }
})

// ────────────────────────────────────────────
// GET /api/ai/collaboration/sessions/:id
// ────────────────────────────────────────────

router.get('/sessions/:id', async (ctx) => {
  const { id } = ctx.params
  const info = getSessionInfo(id)

  ctx.body = {
    success: true,
    data: info,
  }
})

// ────────────────────────────────────────────
// GET /api/ai/collaboration/conversations/:id/export
// ────────────────────────────────────────────

router.get('/conversations/:id/export', async (ctx) => {
  const { id } = ctx.params
  const convo = await getConversation(id)

  if (!convo) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Conversation not found.' } }
    return
  }

  const exportData = {
    id: convo._id,
    source: convo.source,
    activeAgent: convo.activeAgent,
    messages: convo.messages.map((m) => ({
      role: m.role,
      content: m.content,
      thinking: m.thinking,
      tip: m.tip,
      toolCalls: m.toolCalls,
      schema: m.schema,
      flow: m.flow,
      timestamp: m.timestamp,
    })),
    createdAt: convo.createdAt,
    updatedAt: convo.updatedAt,
    exportedAt: new Date(),
  }

  ctx.set('Content-Type', 'application/json')
  ctx.set('Content-Disposition', `attachment; filename="conversation-${id}.json"`)
  ctx.body = exportData
})

export default router
