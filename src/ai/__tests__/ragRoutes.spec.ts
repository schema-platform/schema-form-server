/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock ragService before importing routes
vi.mock('../services/ragService.js', () => ({
  reindexAll: vi.fn().mockResolvedValue({
    total: 5,
    created: 2,
    updated: 1,
    skipped: 2,
    errors: 0,
  }),
  indexSchema: vi.fn().mockResolvedValue({
    schemaId: 'test-schema-id',
    action: 'updated',
  }),
}))

// Mock FormSchemaModel
vi.mock('../../models/FormSchema.js', () => ({
  FormSchemaModel: {
    countDocuments: vi.fn().mockResolvedValue(10),
    find: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        { _id: 'schema-1', name: 'Form A', type: 'form', updatedAt: new Date('2026-01-01') },
        { _id: 'schema-2', name: 'Form B', type: 'form', updatedAt: new Date('2026-01-02') },
      ]),
    }),
    findById: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: 'test-schema-id', name: 'Test Schema' }),
      }),
    }),
  },
}))

// Mock SchemaEmbeddingModel
vi.mock('../../models/SchemaEmbedding.js', () => ({
  SchemaEmbeddingModel: {
    countDocuments: vi.fn().mockResolvedValue(8),
    find: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        { schemaId: 'schema-1', updatedAt: new Date('2026-01-01') },
        { schemaId: 'schema-2', updatedAt: new Date('2025-12-01') },
      ]),
    }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}))

import Koa from 'koa'
import http from 'node:http'
import ragRouter from '../ragRoutes.js'
import { reindexAll, indexSchema } from '../services/ragService.js'
import { FormSchemaModel } from '../../models/FormSchema.js'
import { SchemaEmbeddingModel } from '../../models/SchemaEmbedding.js'

let server: http.Server | null = null
let baseUrl = ''

async function request(method: string, path: string, body?: unknown) {
  const url = `${baseUrl}${path}`
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) options.body = JSON.stringify(body)
  const res = await fetch(url, options)
  const json = await res.json()
  return { status: res.status, body: json }
}

beforeEach(async () => {
  vi.clearAllMocks()

  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  }

  const app = new Koa()
  app.use(ragRouter.routes())
  app.use(ragRouter.allowedMethods())

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server!.address() as { port: number }
      baseUrl = `http://localhost:${addr.port}`
      resolve()
    })
  })
})

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  }
})

describe('POST /api/ai/rag/reindex', () => {
  it('triggers full reindex and returns stats', async () => {
    const res = await request('POST', '/api/ai/rag/reindex')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.total).toBe(5)
    expect(res.body.data.created).toBe(2)
    expect(res.body.data.updated).toBe(1)
    expect(res.body.data.skipped).toBe(2)
    expect(res.body.data.errors).toBe(0)
    expect(reindexAll).toHaveBeenCalledTimes(1)
  })

  it('reports errors from reindex', async () => {
    vi.mocked(reindexAll).mockResolvedValueOnce({
      total: 3,
      created: 0,
      updated: 0,
      skipped: 1,
      errors: 2,
    })

    const res = await request('POST', '/api/ai/rag/reindex')

    expect(res.status).toBe(200)
    expect(res.body.data.errors).toBe(2)
  })
})

describe('GET /api/ai/rag/status', () => {
  it('returns index statistics', async () => {
    const res = await request('GET', '/api/ai/rag/status')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.totalSchemas).toBe(10)
    expect(res.body.data.totalEmbeddings).toBe(8)
    expect(res.body.data.indexed).toBe(2)
    expect(res.body.data.unindexed).toBe(0)
    expect(typeof res.body.data.stale).toBe('number')
  })
})

describe('DELETE /api/ai/rag/:schemaId', () => {
  it('deletes embedding for a valid schema', async () => {
    const res = await request('DELETE', '/api/ai/rag/test-schema-id')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.schemaId).toBe('test-schema-id')
    expect(res.body.data.deleted).toBe(true)
    expect(SchemaEmbeddingModel.deleteOne).toHaveBeenCalledWith({ schemaId: 'test-schema-id' })
  })

  it('returns 404 when schema not found', async () => {
    vi.mocked(FormSchemaModel.findById).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as ReturnType<typeof FormSchemaModel.findById>)

    const res = await request('DELETE', '/api/ai/rag/nonexistent')

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.message).toBe('Schema not found')
  })

  it('returns 404 when no embedding exists', async () => {
    vi.mocked(SchemaEmbeddingModel.deleteOne).mockResolvedValueOnce({ deletedCount: 0 } as never)

    const res = await request('DELETE', '/api/ai/rag/test-schema-id')

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.message).toBe('No embedding found for this schema')
  })
})

describe('POST /api/ai/rag/reindex/:schemaId', () => {
  it('re-indexes a single schema', async () => {
    const res = await request('POST', '/api/ai/rag/reindex/test-schema-id')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.schemaId).toBe('test-schema-id')
    expect(res.body.data.action).toBe('updated')
    expect(indexSchema).toHaveBeenCalledWith('test-schema-id')
  })

  it('returns 404 when schema not found', async () => {
    vi.mocked(FormSchemaModel.findById).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as ReturnType<typeof FormSchemaModel.findById>)

    const res = await request('POST', '/api/ai/rag/reindex/nonexistent')

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.message).toBe('Schema not found')
  })

  it('reports skipped action', async () => {
    vi.mocked(indexSchema).mockResolvedValueOnce({
      schemaId: 'test-schema-id',
      action: 'skipped',
    })

    const res = await request('POST', '/api/ai/rag/reindex/test-schema-id')

    expect(res.status).toBe(200)
    expect(res.body.data.action).toBe('skipped')
  })
})
