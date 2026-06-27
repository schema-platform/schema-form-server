import Router from '@koa/router'
import { mongoose } from '../config/database.js'

const router = new Router()

router.get('/api/health', async (ctx) => {
  let dbStatus: 'connected' | 'disconnected' = 'disconnected'

  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.db!.admin().ping()
      dbStatus = 'connected'
    } catch {
      dbStatus = 'disconnected'
    }
  }

  ctx.body = {
    success: true,
    data: {
      status: 'ok',
      timestamp: Date.now(),
      uptime: process.uptime(),
      database: dbStatus,
    },
  }
})

export default router
