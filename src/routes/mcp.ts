/**
 * MCP routes — SSE transport for Schema, Flow, and Widget MCP servers.
 *
 * Each MCP server exposes:
 *   GET  /api/mcp/{domain}/sse       — establish SSE stream (long-lived)
 *   POST /api/mcp/{domain}/messages  — client → server messages
 */

import Router from '@koa/router'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { createSchemaServer } from '../ai/mcp/schemaServer.js'
import { createFlowServer } from '../ai/mcp/flowServer.js'
import { createWidgetServer } from '../ai/mcp/widgetServer.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const router = new Router({ prefix: '/api/mcp' })

// Active SSE transports keyed by session ID
const transports = new Map<string, SSEServerTransport>()

// Factory map for MCP servers
const serverFactories: Record<string, () => McpServer> = {
  schema: createSchemaServer,
  flow: createFlowServer,
  widget: createWidgetServer,
}

// ── SSE connection endpoint ──
function createSSEHandler(domain: string, factory: () => McpServer) {
  return async (ctx: Router.RouterContext) => {
    // Tell Koa not to manage this response — SSE transport owns it
    ctx.respond = false

    const server = factory()
    const endpoint = `/api/mcp/${domain}/messages`
    const transport = new SSEServerTransport(endpoint, ctx.res)

    transports.set(transport.sessionId, transport)

    ctx.req.on('close', () => {
      transport.close()
      transports.delete(transport.sessionId)
    })

    await server.connect(transport)
  }
}

// ── POST message endpoint ──
function createMessageHandler() {
  return async (ctx: Router.RouterContext) => {
    const sessionId = ctx.query.sessionId as string
    if (!sessionId) {
      ctx.status = 400
      ctx.body = { error: 'Missing sessionId query parameter' }
      return
    }

    const transport = transports.get(sessionId)
    if (!transport) {
      ctx.status = 400
      ctx.body = { error: 'No active session for this sessionId' }
      return
    }

    // Pass the already-parsed body to avoid double-read of the request stream
    await transport.handlePostMessage(ctx.req, ctx.res, ctx.request.body)
  }
}

// Register routes for each domain
for (const [domain, factory] of Object.entries(serverFactories)) {
  router.get(`/${domain}/sse`, createSSEHandler(domain, factory))
  router.post(`/${domain}/messages`, createMessageHandler())
}

export default router
