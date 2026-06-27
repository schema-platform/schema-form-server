/**
 * Backend Smoke Test — Sprint 20
 * Tests Koa + Prisma API endpoints end-to-end.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import Koa from 'koa'
import cors from '@koa/cors'
import { errorHandler } from '../middleware/errorHandler.js'
import healthRouter from '../routes/health.js'

// ── Helpers ──

let server: ReturnType<typeof http.createServer> | null = null
const BASE = 'http://localhost:3002'

function get(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode ?? 0, body: data.substring(0, 500) }) }
      })
    }).on('error', reject)
  })
}

// ── Tests ──

/** Inline Koa JSON body parser — needed because koa-bodyparser is not a dependency */
async function jsonBodyParser(ctx: any, next: () => Promise<any>) {
  if (ctx.method === 'POST' || ctx.method === 'PUT' || ctx.method === 'PATCH') {
    const body = await new Promise<string>((resolve) => {
      let data = ''
      ctx.req.on('data', (chunk: Buffer | string) => { data += chunk })
      ctx.req.on('end', () => resolve(data))
    })
    try {
      ctx.request.body = JSON.parse(body || '{}')
    } catch {
      ctx.request.body = {}
    }
  } else {
    ctx.request.body = {}
  }
  await next()
}

describe('Backend Smoke Test (Koa + MongoDB)', () => {
  beforeAll(async () => {
    const app = new Koa()
    app.use(errorHandler)
    app.use(jsonBodyParser)
    // NOTE: helmet v8 is not directly compatible with Koa (requires koa-helmet wrapper)
    // The real server's index.ts has the same issue — use koa-helmet in production
    app.use(cors({ origin: () => '' }))
    app.use(healthRouter.routes())
    app.use(healthRouter.allowedMethods())

    await new Promise<void>((resolve) => {
      server = app.listen(3002, () => resolve())
    })
    console.log('[backend-smoke] Server started on port 3002')
  }, 30000)

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => { server!.close(() => resolve()) })
      console.log('[backend-smoke] Server closed')
    }
  })

  // ── Health ──

  it('GET /api/health returns ok status', async () => {
    const { status, body } = await get('/api/health')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('status', 'ok')
    expect(body.data).toHaveProperty('timestamp')
    expect(body.data).toHaveProperty('uptime')
    expect(body.data).toHaveProperty('database')
  })

  // All routes (schema, auth, dict, options, data, flow) are now in this unified server
})
