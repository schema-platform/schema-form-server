import Koa from 'koa'
import cors from '@koa/cors'
import helmet from 'koa-helmet'
import bodyParser from 'koa-bodyparser'
import ratelimit from 'koa-ratelimit'
import { errorHandler } from './middleware/errorHandler.js'
import { timeoutMiddleware } from './middleware/timeout.js'
import { tenantContextMiddleware } from './middleware/tenantContext.js'
import healthRouter from './routes/health.js'
import authRouter from './routes/auth.js'
import ssoRouter from './routes/sso.js'
import dictRouter from './routes/dict.js'
import optionsRouter from './routes/options.js'
import dataRouter from './routes/data.js'
import schemaRouter from './routes/schema.js'
import mockRouter from './routes/mock.js'
import docsRouter from './routes/docs.js'
import usersRouter from './routes/users.js'
import rolesRouter from './routes/roles.js'
import statsRouter from './routes/stats.js'
import templateRouter from './routes/template.js'
import tenantRouter from './routes/tenant.js'
import deptsRouter from './routes/depts.js'
import menusRouter from './routes/menus.js'
import postsRouter from './routes/posts.js'
import flowExportRouter from './flow-routes/flowExport.js'
import flowActionRouter from './flow-routes/flowAction.js'
import flowMessageRouter from './flow-routes/flowMessage.js'
import flowRouter from './flow-routes/flow.js'
import flowVersionRouter from './flow-routes/flowVersion.js'
import flowInstanceRouter from './flow-routes/flowInstance.js'
import flowTaskRouter from './flow-routes/flowTask.js'
import flowTimerRouter from './flow-routes/flowTimer.js'
import flowApprovalRouter from './flow-routes/flowApproval.js'
import flowBatchRouter from './flow-routes/flowBatch.js'
import flowNotificationRouter from './flow-routes/flowNotification.js'
import flowTemplateRouter from './flow-routes/flowTemplate.js'
import flowMonitorRouter from './flow-routes/flowMonitor.js'
import { aiRouter, monitorRouter, aiHealthRouter, ragRouter, llmProviderRouter, collaborationRouter, promptsRouter } from './ai/index.js'
import aiPluginRouter from './ai/pluginRoutes.js'
import mcpRouter from './routes/mcp.js'
import configRouter from './routes/config.js'
import auditLogRouter from './routes/auditLog.js'
import microAppRouter from './routes/microApp.js'
import apiKeyRouter from './routes/apiKey.js'
import submissionRouter from './routes/submission.js'
import webhookRouter from './routes/webhook.js'
import webhookTriggerRouter from './routes/webhookTrigger.js'
import credentialRouter from './routes/credential.js'
import modelConfigRouter from './routes/modelConfig.js'
import loginLogRouter from './routes/loginLog.js'
import onlineUsersRouter from './routes/onlineUsers.js'
import userImportExportRouter from './routes/userImportExport.js'
import filesRouter from './routes/files.js'
import { auditLogMiddleware } from './middleware/auditLog.js'
import { connectRedis } from './config/redis.js'
import { validateApiKey } from './ai/graph/agentBase.js'

// ── Startup validation ──
validateApiKey()

// ── Redis (non-blocking, optional in dev) ──
connectRedis()

const app = new Koa()

// --- Middleware stack ---
app.use(errorHandler)
// 开发环境禁用 rate limiter
if (process.env.NODE_ENV !== 'development') {
  app.use(ratelimit({
    driver: 'memory',
    db: new Map(),
    duration: 60_000,
    max: 100,
    id: (ctx) => ctx.ip,
    headers: {
      remaining: 'Rate-Limit-Remaining',
      reset: 'Rate-Limit-Reset',
      total: 'Rate-Limit-Total',
    },
    errorMessage: 'Too many requests, please try again later.',
    disableHeader: false,
  }))
}
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}))
app.use(bodyParser())

app.use(cors({
  origin: (ctx) => {
    const origins = process.env.CORS_ORIGINS || 'http://localhost:4000,http://localhost:5050,http://localhost:5100,http://localhost:5200,http://localhost:5300,http://localhost:5400,http://localhost:4173,http://127.0.0.1:4000,https://schema-form-platform.vercel.app'
    if (origins === '*') return ctx.get('Origin')
    const allowed = origins.split(',').map((s) => s.trim())
    const requestOrigin = ctx.get('Origin')
    return allowed.includes(requestOrigin) ? requestOrigin : ''
  },
  credentials: true,
}))

app.use(tenantContextMiddleware())
app.use(timeoutMiddleware(30_000))
app.use(auditLogMiddleware)

// --- Routes ---
app.use(healthRouter.routes())
app.use(healthRouter.allowedMethods())
app.use(authRouter.routes())
app.use(authRouter.allowedMethods())
app.use(ssoRouter.routes())
app.use(ssoRouter.allowedMethods())
app.use(schemaRouter.routes())
app.use(schemaRouter.allowedMethods())
app.use(mockRouter.routes())
app.use(mockRouter.allowedMethods())
app.use(docsRouter.routes())
app.use(docsRouter.allowedMethods())
app.use(usersRouter.routes())
app.use(usersRouter.allowedMethods())
app.use(rolesRouter.routes())
app.use(rolesRouter.allowedMethods())
app.use(statsRouter.routes())
app.use(statsRouter.allowedMethods())
app.use(dictRouter.routes())
app.use(dictRouter.allowedMethods())
app.use(optionsRouter.routes())
app.use(optionsRouter.allowedMethods())
app.use(dataRouter.routes())
app.use(dataRouter.allowedMethods())
app.use(templateRouter.routes())
app.use(templateRouter.allowedMethods())
app.use(tenantRouter.routes())
app.use(tenantRouter.allowedMethods())
app.use(deptsRouter.routes())
app.use(deptsRouter.allowedMethods())
app.use(menusRouter.routes())
app.use(menusRouter.allowedMethods())
app.use(postsRouter.routes())
app.use(postsRouter.allowedMethods())
app.use(flowRouter.routes())
app.use(flowRouter.allowedMethods())
app.use(flowVersionRouter.routes())
app.use(flowVersionRouter.allowedMethods())
app.use(flowInstanceRouter.routes())
app.use(flowInstanceRouter.allowedMethods())
app.use(flowBatchRouter.routes())
app.use(flowBatchRouter.allowedMethods())
app.use(flowTaskRouter.routes())
app.use(flowTaskRouter.allowedMethods())
app.use(flowTimerRouter.routes())
app.use(flowTimerRouter.allowedMethods())
app.use(flowApprovalRouter.routes())
app.use(flowApprovalRouter.allowedMethods())
app.use(flowNotificationRouter.routes())
app.use(flowNotificationRouter.allowedMethods())
app.use(flowTemplateRouter.routes())
app.use(flowTemplateRouter.allowedMethods())
app.use(flowMonitorRouter.routes())
app.use(flowMonitorRouter.allowedMethods())
app.use(flowExportRouter.routes())
app.use(flowExportRouter.allowedMethods())
app.use(flowActionRouter.routes())
app.use(flowActionRouter.allowedMethods())
app.use(flowMessageRouter.routes())
app.use(flowMessageRouter.allowedMethods())
app.use(aiRouter.routes())
app.use(aiRouter.allowedMethods())
app.use(aiHealthRouter.routes())
app.use(aiHealthRouter.allowedMethods())
app.use(monitorRouter.routes())
app.use(monitorRouter.allowedMethods())
app.use(aiPluginRouter.routes())
app.use(aiPluginRouter.allowedMethods())
app.use(ragRouter.routes())
app.use(ragRouter.allowedMethods())
app.use(llmProviderRouter.routes())
app.use(llmProviderRouter.allowedMethods())
app.use(collaborationRouter.routes())
app.use(collaborationRouter.allowedMethods())
app.use(promptsRouter.routes())
app.use(promptsRouter.allowedMethods())
app.use(mcpRouter.routes())
app.use(mcpRouter.allowedMethods())
app.use(configRouter.routes())
app.use(configRouter.allowedMethods())
app.use(auditLogRouter.routes())
app.use(auditLogRouter.allowedMethods())
app.use(microAppRouter.routes())
app.use(microAppRouter.allowedMethods())
app.use(apiKeyRouter.routes())
app.use(apiKeyRouter.allowedMethods())
app.use(submissionRouter.routes())
app.use(submissionRouter.allowedMethods())
app.use(webhookRouter.routes())
app.use(webhookRouter.allowedMethods())
app.use(webhookTriggerRouter.routes())
app.use(webhookTriggerRouter.allowedMethods())
app.use(credentialRouter.routes())
app.use(credentialRouter.allowedMethods())
app.use(modelConfigRouter.routes())
app.use(modelConfigRouter.allowedMethods())
app.use(loginLogRouter.routes())
app.use(loginLogRouter.allowedMethods())
app.use(onlineUsersRouter.routes())
app.use(onlineUsersRouter.allowedMethods())
app.use(userImportExportRouter.routes())
app.use(userImportExportRouter.allowedMethods())
app.use(filesRouter.routes())
app.use(filesRouter.allowedMethods())

export default app
