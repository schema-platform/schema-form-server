import 'dotenv/config'
import { createServer } from 'node:http'
import app from './app.js'
import { connectDatabase, mongoose } from './config/database.js'
import { initSocket } from './socket.js'
import { initWebhookDispatcher } from './services/webhookDispatcher.js'
import { initDefaultTenant } from './utils/initDefaultTenant.js'
import { seedBuiltinTemplates } from './utils/seedBuiltinTemplates.js'
import { seedPermissions } from './utils/seedPermissions.js'
import { seedAdmin } from './utils/seedAdmin.js'
import { seedMicroApps } from './utils/seedMicroApps.js'
import { seedMenus } from './utils/seedMenus.js'
import { seedRoles } from './utils/seedRoles.js'
import { seedClients } from './utils/seedClients.js'

const PORT = parseInt(process.env.PORT ?? '3001', 10)

async function start() {
  await connectDatabase()
  await initDefaultTenant()
  await seedPermissions()
  await seedMicroApps()
  await seedMenus()
  await seedRoles()
  await seedBuiltinTemplates()
  await seedClients()
  await seedAdmin()

  initWebhookDispatcher()

  const httpServer = createServer(app.callback())
  initSocket(httpServer)

  const server = httpServer.listen(PORT, () => {
    console.log(`[server] Schema API running at http://localhost:${PORT}`)
    console.log(`[server] Health check: http://localhost:${PORT}/api/health`)

    // SSE 流式输出超时配置
    server.keepAliveTimeout = 300_000  // 5 分钟
    server.headersTimeout = 310_000    // 比 keepAliveTimeout 略大
  })

  let shuttingDown = false
  async function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[server] Received ${signal}, shutting down gracefully...`)

    server.close(async () => {
      console.log('[server] HTTP server closed')
      try {
        await mongoose.disconnect()
        console.log('[server] MongoDB disconnected')
      } catch { /* DB might already be closed */ }
      process.exit(0)
    })

    setTimeout(() => {
      console.log('[server] Forced shutdown after timeout')
      process.exit(1)
    }, 30_000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  return server
}

start()
