import Router from '@koa/router'
import { authMiddleware } from '../middleware/auth.js'
import { notificationService } from '../flow-services/NotificationService.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/flow/notifications' })

// GET /api/flow/notifications — list notifications with pagination
router.get('/', requireAuth, async (ctx) => {
  const userId = (ctx.state.user as { id: string }).id
  const { page: pageStr = '1', pageSize: pageSizeStr = '20', unreadOnly: unreadOnlyStr } = ctx.query

  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const unreadOnly = unreadOnlyStr === 'true'

  const result = await notificationService.getNotifications(userId, { page, pageSize, unreadOnly })
  ctx.body = { success: true, data: result }
})

// GET /api/flow/notifications/unread-count — get unread notification count
router.get('/unread-count', requireAuth, async (ctx) => {
  const userId = (ctx.state.user as { id: string }).id
  const count = await notificationService.getUnreadCount(userId)
  ctx.body = { success: true, data: { count } }
})

// PUT /api/flow/notifications/:id/read — mark single notification as read
router.put('/:id/read', requireAuth, async (ctx) => {
  const userId = (ctx.state.user as { id: string }).id
  const { id } = ctx.params

  const notification = await notificationService.markAsRead(id, userId)
  if (!notification) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Notification not found.' } }
    return
  }

  ctx.body = { success: true, data: notification }
})

// POST /api/flow/notifications/batch-read — mark multiple notifications as read
router.post('/batch-read', requireAuth, async (ctx) => {
  const userId = (ctx.state.user as { id: string }).id
  const { ids } = ctx.body as { ids?: string[] }

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'ids array is required.' } }
    return
  }

  const count = await notificationService.markBatchAsRead(ids, userId)
  ctx.body = { success: true, data: { modifiedCount: count } }
})

// PUT /api/flow/notifications/read-all — mark all notifications as read
router.put('/read-all', requireAuth, async (ctx) => {
  const userId = (ctx.state.user as { id: string }).id
  const count = await notificationService.markAllAsRead(userId)
  ctx.body = { success: true, data: { modifiedCount: count } }
})

export default router
