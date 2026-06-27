/**
 * AI Version Management API Tests
 *
 * Tests:
 * - Version service: createVersion, getVersions, getVersion
 * - GET  /api/ai/conversations/:id/versions (list)
 * - GET  /api/ai/versions/:versionId (detail)
 * - POST /api/ai/conversations/:id/rollback
 * - GET  /api/ai/versions/compare
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import Koa from 'koa'
import Router from '@koa/router'
import cors from '@koa/cors'
import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { errorHandler } from '../middleware/errorHandler.js'
import { AIVersionModel } from '../ai/models/version.js'
import {
  createVersion,
  getVersions,
  getVersion,
} from '../ai/services/versionService.js'

// ── DB connection ──

const TEST_MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/test-ai-version'

// ── Inline JSON body parser ──

async function jsonBodyParser(ctx: any, next: () => Promise<any>) {
  if (ctx.method === 'POST' || ctx.method === 'PUT' || ctx.method === 'PATCH') {
    const body = await new Promise<string>((resolve) => {
      let data = ''
      ctx.req.on('data', (chunk: Buffer | string) => { data += chunk })
      ctx.req.on('end', () => resolve(data))
    })
    try { ctx.request.body = JSON.parse(body || '{}') }
    catch { ctx.request.body = {} }
  } else {
    ctx.request.body = {}
  }
  await next()
}

// ── HTTP helpers ──

let server: ReturnType<typeof http.createServer> | null = null
const BASE = 'http://localhost:3003'

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

function post(path: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode ?? 0, body: data.substring(0, 500) }) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// ── Test data ──

const CONVO_ID = `test-convo-${uuidv4()}`
const SCHEMA_V1 = [
  { id: 'w1', type: 'input', label: 'Name', field: 'name' },
  { id: 'w2', type: 'select', label: 'Status', field: 'status' },
]
const SCHEMA_V2 = [
  { id: 'w1', type: 'input', label: 'Full Name', field: 'fullName' },
  { id: 'w2', type: 'select', label: 'Status', field: 'status' },
  { id: 'w3', type: 'datepicker', label: 'Date', field: 'date' },
]
const FLOW_V1 = {
  nodes: [
    { id: 'n1', data: { label: 'Start', bpmnType: 'startEvent' } },
    { id: 'n2', data: { label: 'Task A', bpmnType: 'userTask' } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
}
const FLOW_V2 = {
  nodes: [
    { id: 'n1', data: { label: 'Start', bpmnType: 'startEvent' } },
    { id: 'n2', data: { label: 'Task A Updated', bpmnType: 'userTask' } },
    { id: 'n3', data: { label: 'Task B', bpmnType: 'userTask' } },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
  ],
}

// ── Test suite ──

describe('AI Version Management', () => {
  const versionIds: string[] = []

  beforeAll(async () => {
    mongoose.set('strictQuery', false)
    await mongoose.connect(TEST_MONGO_URI, {
      maxPoolSize: 5,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    })

    // Seed test versions
    const v1 = await createVersion({ conversationId: CONVO_ID, messageId: 'msg-1', type: 'schema', content: SCHEMA_V1, description: 'Initial schema' })
    const v2 = await createVersion({ conversationId: CONVO_ID, messageId: 'msg-2', type: 'schema', content: SCHEMA_V2, description: 'Updated schema' })
    const v3 = await createVersion({ conversationId: CONVO_ID, messageId: 'msg-3', type: 'flow', content: FLOW_V1, description: 'Initial flow' })
    const v4 = await createVersion({ conversationId: CONVO_ID, messageId: 'msg-4', type: 'flow', content: FLOW_V2, description: 'Updated flow' })
    versionIds.push(v1._id, v2._id, v3._id, v4._id)

    // Build test Koa app
    const app = new Koa()
    app.use(errorHandler)
    app.use(jsonBodyParser)
    app.use(cors({ origin: () => '' }))

    const router = new Router({ prefix: '/api/ai' })

    router.get('/conversations/:id/versions', async (ctx) => {
      const versions = await getVersions(ctx.params.id)
      ctx.body = {
        success: true,
        data: versions.map((v) => ({
          id: v._id,
          version: v.version,
          type: v.type,
          description: v.description,
          createdAt: v.createdAt,
        })),
      }
    })

    // IMPORTANT: /versions/compare must be registered BEFORE /versions/:versionId
    // otherwise "compare" matches as a :versionId param
    router.get('/versions/compare', async (ctx) => {
      const { v1, v2 } = ctx.query as { v1?: string; v2?: string }
      if (!v1 || !v2) {
        ctx.status = 400
        ctx.body = { success: false, error: { message: 'v1 and v2 query parameters are required' } }
        return
      }
      const [ver1, ver2] = await Promise.all([getVersion(v1), getVersion(v2)])
      if (!ver1) {
        ctx.status = 404
        ctx.body = { success: false, error: { message: `Version ${v1} not found.` } }
        return
      }
      if (!ver2) {
        ctx.status = 404
        ctx.body = { success: false, error: { message: `Version ${v2} not found.` } }
        return
      }
      if (ver1.type !== ver2.type) {
        ctx.status = 400
        ctx.body = { success: false, error: { message: 'Cannot compare versions of different types (schema vs flow).' } }
        return
      }

      // Simple diff logic for test validation
      function diffSchema(oldW: any[], newW: any[]) {
        const changes: any[] = []
        let added = 0, removed = 0, modified = 0
        const oldMap = new Map(oldW.map((w: any) => [w.id, w]))
        const newMap = new Map(newW.map((w: any) => [w.id, w]))
        for (const [id] of oldMap) { if (!newMap.has(id)) { removed++; changes.push({ type: 'remove', elementId: id }) } }
        for (const [id, w] of newMap) {
          const old = oldMap.get(id)
          if (!old) { added++; changes.push({ type: 'add', elementId: id }) }
          else if (JSON.stringify(old) !== JSON.stringify(w)) { modified++; changes.push({ type: 'modify', elementId: id }) }
        }
        return { changes, summary: { added, removed, modified } }
      }

      function diffFlow(oldF: any, newF: any) {
        const changes: any[] = []
        let added = 0, removed = 0, modified = 0
        const oldNodes = new Map((oldF.nodes ?? []).map((n: any) => [n.id, n]))
        const newNodes = new Map((newF.nodes ?? []).map((n: any) => [n.id, n]))
        for (const [id] of oldNodes) { if (!newNodes.has(id)) { removed++; changes.push({ type: 'remove', elementId: id }) } }
        for (const [id, node] of newNodes) {
          const old = oldNodes.get(id)
          if (!old) { added++; changes.push({ type: 'add', elementId: id }) }
          else if (JSON.stringify(old.data) !== JSON.stringify(node.data)) { modified++; changes.push({ type: 'modify', elementId: id }) }
        }
        const oldEdges = new Map((oldF.edges ?? []).map((e: any) => [e.id, e]))
        const newEdges = new Map((newF.edges ?? []).map((e: any) => [e.id, e]))
        for (const [id] of oldEdges) { if (!newEdges.has(id)) { removed++; changes.push({ type: 'remove', elementId: id }) } }
        for (const [id] of newEdges) { if (!oldEdges.has(id)) { added++; changes.push({ type: 'add', elementId: id }) } }
        return { changes, summary: { added, removed, modified } }
      }

      const diff = ver1.type === 'schema'
        ? diffSchema(ver1.content as any[], ver2.content as any[])
        : diffFlow(ver1.content, ver2.content)

      ctx.body = {
        success: true,
        data: {
          v1: { id: ver1._id, version: ver1.version, type: ver1.type },
          v2: { id: ver2._id, version: ver2.version, type: ver2.type },
          diff,
        },
      }
    })

    router.get('/versions/:versionId', async (ctx) => {
      const version = await getVersion(ctx.params.versionId)
      if (!version) {
        ctx.status = 404
        ctx.body = { success: false, error: { message: 'Version not found.' } }
        return
      }
      ctx.body = {
        success: true,
        data: {
          id: version._id,
          conversationId: version.conversationId,
          version: version.version,
          type: version.type,
          content: version.content,
          description: version.description,
          createdAt: version.createdAt,
        },
      }
    })

    router.post('/conversations/:id/rollback', async (ctx) => {
      const { versionId } = ctx.request.body as { versionId: string }
      if (!versionId) {
        ctx.status = 400
        ctx.body = { success: false, error: { message: 'versionId is required' } }
        return
      }
      const version = await getVersion(versionId)
      if (!version || version.conversationId !== ctx.params.id) {
        ctx.status = 404
        ctx.body = { success: false, error: { message: 'Version not found in this conversation.' } }
        return
      }
      const newVersion = await createVersion({
        conversationId: ctx.params.id,
        messageId: 'rollback',
        type: version.type,
        content: version.content,
        description: `回滚到版本 v${version.version}`,
      })
      ctx.body = {
        success: true,
        data: {
          id: newVersion._id,
          version: newVersion.version,
          type: newVersion.type,
          content: newVersion.content,
          description: newVersion.description,
          rollbackFrom: versionId,
        },
      }
    })

    app.use(router.routes())
    app.use(router.allowedMethods())

    await new Promise<void>((resolve) => {
      server = app.listen(3003, () => resolve())
    })
  }, 30000)

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => { server!.close(() => resolve()) })
    }
    await AIVersionModel.deleteMany({ conversationId: CONVO_ID })
    await mongoose.disconnect()
  })

  // ── Version Service ──

  describe('versionService', () => {
    it('getVersion returns a single version by id', async () => {
      const v = await getVersion(versionIds[0])
      expect(v).not.toBeNull()
      expect(v!._id).toBe(versionIds[0])
      expect(v!._id).toBe(versionIds[0])
      expect(v!.type).toBe('schema')
      expect(v!.content).toEqual(SCHEMA_V1)
    })

    it('getVersion returns null for non-existent id', async () => {
      const v = await getVersion('nonexistent-id')
      expect(v).toBeNull()
    })

    it('getVersions returns all versions for a conversation sorted desc', async () => {
      const versions = await getVersions(CONVO_ID)
      expect(versions.length).toBeGreaterThanOrEqual(4)
      // Descending order
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i - 1].version).toBeGreaterThanOrEqual(versions[i].version)
      }
    })

    it('getVersions returns empty array for non-existent conversation', async () => {
      const versions = await getVersions('nonexistent-convo')
      expect(versions).toHaveLength(0)
    })

    it('createVersion auto-increments version number', async () => {
      const maxBefore = (await AIVersionModel.findOne({ conversationId: CONVO_ID }).sort({ version: -1 }).select('version'))?.version ?? 0
      const v = await createVersion({
        conversationId: CONVO_ID,
        messageId: 'msg-auto',
        type: 'schema',
        content: [{ id: 'auto', type: 'input' }],
        description: 'Auto increment test',
      })
      expect(v.version).toBe(maxBefore + 1)
    })
  })

  // ── List versions endpoint ──

  describe('GET /api/ai/conversations/:id/versions', () => {
    it('returns all versions for a conversation', async () => {
      const { status, body } = await get(`/api/ai/conversations/${CONVO_ID}/versions`)
      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.length).toBeGreaterThanOrEqual(4)
      // Sorted descending
      expect(body.data[0].version).toBeGreaterThanOrEqual(body.data[1].version)
    })

    it('returns empty array for non-existent conversation', async () => {
      const { status, body } = await get('/api/ai/conversations/nonexistent/versions')
      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
    })
  })

  // ── Version detail endpoint ──

  describe('GET /api/ai/versions/:versionId', () => {
    it('returns version detail with content', async () => {
      const { status, body } = await get(`/api/ai/versions/${versionIds[0]}`)
      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.id).toBe(versionIds[0])
      expect(body.data.type).toBe('schema')
      expect(body.data.content).toEqual(SCHEMA_V1)
      expect(body.data.description).toBe('Initial schema')
      expect(body.data.conversationId).toBe(CONVO_ID)
    })

    it('returns 404 for non-existent version', async () => {
      const { status, body } = await get('/api/ai/versions/nonexistent-id')
      expect(status).toBe(404)
      expect(body.success).toBe(false)
    })
  })

  // ── Rollback endpoint ──

  describe('POST /api/ai/conversations/:id/rollback', () => {
    it('creates a new version from rollback target', async () => {
      const { status, body } = await post(`/api/ai/conversations/${CONVO_ID}/rollback`, {
        versionId: versionIds[0],
      })
      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.type).toBe('schema')
      expect(body.data.content).toEqual(SCHEMA_V1)
      expect(body.data.description).toContain('回滚')
      expect(body.data.rollbackFrom).toBe(versionIds[0])
    })

    it('returns 400 when versionId is missing', async () => {
      const { status, body } = await post(`/api/ai/conversations/${CONVO_ID}/rollback`, {})
      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.error.message).toContain('versionId')
    })

    it('returns 404 for non-existent version', async () => {
      const { status, body } = await post(`/api/ai/conversations/${CONVO_ID}/rollback`, {
        versionId: 'nonexistent-id',
      })
      expect(status).toBe(404)
      expect(body.success).toBe(false)
    })

    it('returns 404 when version does not belong to conversation', async () => {
      const { status, body } = await post('/api/ai/conversations/other-convo/rollback', {
        versionId: versionIds[0],
      })
      expect(status).toBe(404)
      expect(body.success).toBe(false)
    })
  })

  // ── Compare endpoint ──

  describe('GET /api/ai/versions/compare', () => {
    it('compares two schema versions and returns diff', async () => {
      const { status, body } = await get(
        `/api/ai/versions/compare?v1=${versionIds[0]}&v2=${versionIds[1]}`,
      )
      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.v1.id).toBe(versionIds[0])
      expect(body.data.v2.id).toBe(versionIds[1])
      expect(body.data.diff).toBeDefined()
      expect(body.data.diff.summary).toBeDefined()
      // V1: 2 widgets, V2: 3 widgets (w1 modified, w3 added)
      expect(body.data.diff.summary.added).toBe(1)
      expect(body.data.diff.summary.removed).toBe(0)
      expect(body.data.diff.summary.modified).toBe(1)
    })

    it('compares two flow versions and returns diff', async () => {
      const { status, body } = await get(
        `/api/ai/versions/compare?v1=${versionIds[2]}&v2=${versionIds[3]}`,
      )
      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.v1.type).toBe('flow')
      // V1: 2 nodes + 1 edge, V2: 3 nodes + 2 edges, n2 data changed
      expect(body.data.diff.summary.added).toBe(2) // n3 + e2
      expect(body.data.diff.summary.removed).toBe(0)
      expect(body.data.diff.summary.modified).toBe(1) // n2 data changed
    })

    it('returns 400 when v1 or v2 is missing', async () => {
      const { status, body } = await get('/api/ai/versions/compare?v1=some-id')
      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.error.message).toContain('required')
    })

    it('returns 404 when a version does not exist', async () => {
      const { status, body } = await get(
        `/api/ai/versions/compare?v1=${versionIds[0]}&v2=nonexistent`,
      )
      expect(status).toBe(404)
      expect(body.success).toBe(false)
    })

    it('returns 400 when comparing different types', async () => {
      const { status, body } = await get(
        `/api/ai/versions/compare?v1=${versionIds[0]}&v2=${versionIds[2]}`,
      )
      expect(status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.error.message).toContain('different types')
    })
  })
})
