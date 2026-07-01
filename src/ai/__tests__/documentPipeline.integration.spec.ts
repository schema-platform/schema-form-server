/**
 * 两条文档线全量验证 — Chat + Workflow
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import http from 'node:http'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../../config/jwt.js'

// ── Workflow webhook mocks ──
const startExecution = vi.fn()
const findWebhook = vi.fn()

vi.mock('../services/agentWorkflowService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/agentWorkflowService.js')>()
  return {
    ...actual,
    findPublishedWorkflowByWebhook: (...args: unknown[]) => findWebhook(...args),
    startAgentWorkflowExecution: (...args: unknown[]) => startExecution(...args),
  }
})

vi.mock('../services/llmCache.js', () => ({
  getLLM: vi.fn(),
}))

const docStore = new Map<string, Record<string, unknown>>()

function lookupDoc(filter: Record<string, unknown>) {
  const id = filter._id != null ? String(filter._id) : ''
  const hit = docStore.get(id)
  if (!hit) return null
  if (filter.uploadedBy && hit.uploadedBy !== filter.uploadedBy) return null
  return hit
}

vi.mock('../models/document.js', () => ({
  DocumentModel: {
    create: vi.fn(async (doc: Record<string, unknown>) => {
      const id = String(doc._id)
      const record: Record<string, unknown> = {
        ...doc,
        _id: doc._id,
        toJSON() {
          return { ...this, _id: id, id }
        },
      }
      docStore.set(id, record)
      return record
    }),
    findOne: vi.fn((filter: Record<string, unknown>) => {
      const base = () => lookupDoc(filter)
      return {
        lean: async () => base(),
        then(
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          const hit = base()
          const doc = hit
            ? {
                ...hit,
                save: async function save(this: Record<string, unknown>) {
                  docStore.set(String(hit._id), { ...this })
                },
              }
            : null
          return Promise.resolve(doc).then(onFulfilled, onRejected)
        },
      }
    }),
    find: vi.fn(() => ({
      lean: async () => Array.from(docStore.values()),
    })),
  },
}))

import documentRouter from '../documentRoutes.js'
import webhookRouter from '../agentWorkflowWebhookRoutes.js'
import { processFile } from '../services/fileService.js'
import { createDocumentFromUpload, getDocumentPreview, reprocessDocumentFromStorage } from '../services/documentService.js'
import { chunkText } from '../services/documentService.js'
import { buildWebhookSignaturePayload, verifyWebhookHmac } from '../services/agentWorkflowWebhookUtils.js'

const TEST_USER = '507f1f77bcf86cd799439011'
const TEST_TENANT = '000000'

function testAuthHeaders(): Record<string, string> {
  const token = jwt.sign(
    {
      id: TEST_USER,
      username: 'admin',
      roles: ['admin'],
      tenantId: TEST_TENANT,
      deptId: null,
      tokenType: 'access',
    },
    JWT_SECRET,
  )
  return { Authorization: `Bearer ${token}` }
}

let server: http.Server | null = null
let baseUrl = ''
let tempRoot = ''

async function api(
  method: string,
  urlPath: string,
  opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean } = {},
) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.auth !== false ? testAuthHeaders() : {}),
      ...opts.headers,
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: text }
  }
}

function mountApp(router: Koa.Middleware) {
  const app = new Koa()
  app.use(bodyParser())
  app.use(async (ctx, next) => {
    ctx.state.user = { id: TEST_USER, tenantId: TEST_TENANT }
    await next()
  })
  app.use(router)
  return app
}

describe('Document pipeline — full verification', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    docStore.clear()
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-pipeline-'))
    process.env.AI_DOCUMENT_STORAGE_ROOT = tempRoot
    process.env.AI_WEBHOOK_SKIP_HMAC = 'false'
    process.env.NODE_ENV = 'test'

    if (server) {
      await new Promise<void>((r) => server!.close(() => r()))
      server = null
    }
  })

  afterEach(async () => {
    delete process.env.AI_DOCUMENT_STORAGE_ROOT
    delete process.env.AI_WEBHOOK_SKIP_HMAC
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()))
      server = null
    }
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  describe('Line B — Workflow: fileService + storage + document-parse data', () => {
    it('processes TXT and persists to disk + mongo', async () => {
      const buffer = Buffer.from('工作流文档测试内容\n第二行', 'utf-8')
      const processed = await processFile(buffer, 'wf-test.txt', 'text/plain')
      expect(processed.extractionMethod).toBe('txt')
      expect(processed.text).toContain('工作流')

      const created = await createDocumentFromUpload(
        buffer,
        'wf-test.txt',
        'text/plain',
        TEST_USER,
        TEST_TENANT,
      )
      expect(created.id).toBeTruthy()
      expect(created.hasOriginalFile).toBe(true)
      expect(created.extractionMethod).toBe('txt')

      const preview = await getDocumentPreview(created.id, TEST_USER)
      expect(preview?.text).toContain('工作流')
      expect(preview?.hasOriginalFile).toBe(true)
    })

    it('reparse from stored file updates text', async () => {
      const buffer = Buffer.from('initial', 'utf-8')
      const created = await createDocumentFromUpload(
        buffer,
        'reparse.txt',
        'text/plain',
        TEST_USER,
        TEST_TENANT,
      )

      const stored = docStore.get(created.id)
      expect(stored).toBeTruthy()
      const storagePath = stored!.storagePath as string
      await fs.writeFile(
        path.join(tempRoot, storagePath),
        'replaced content from disk',
        'utf-8',
      )

      const reparsed = await reprocessDocumentFromStorage(created.id, TEST_USER)
      expect(reparsed?.text).toBe('replaced content from disk')
    })

    it('chunkText splits for workflow LLM nodes', () => {
      const chunks = chunkText('a'.repeat(9000), 4000)
      expect(chunks).toHaveLength(3)
    })
  })

  describe('Line B — Workflow: Webhook HMAC HTTP', () => {
    beforeEach(async () => {
      const app = mountApp(webhookRouter.routes())
      server = http.createServer(app.callback())
      await new Promise<void>((r) => server!.listen(0, r))
      const addr = server!.address() as { port: number }
      baseUrl = `http://127.0.0.1:${addr.port}`
    })

    it('rejects missing signature when secret configured', async () => {
      findWebhook.mockResolvedValue({
        workflowId: '507f1f77bcf86cd799439022',
        workflowName: 'WF',
        createdBy: TEST_USER,
        webhookSecret: 'test-secret-key',
      })

      const res = await api('POST', '/api/ai/webhooks/doc-hook', {
        body: { documentId: 'abc' },
        auth: false,
      })
      expect(res.status).toBe(401)
    })

    it('accepts valid HMAC and starts execution', async () => {
      const secret = 'test-secret-key'
      const body = { documentId: '507f1f77bcf86cd799439033' }
      const payload = buildWebhookSignaturePayload('POST', body, {})
      const sig = createHmac('sha256', secret).update(payload).digest('hex')

      findWebhook.mockResolvedValue({
        workflowId: '507f1f77bcf86cd799439022',
        workflowName: 'WF',
        createdBy: TEST_USER,
        webhookSecret: secret,
      })
      startExecution.mockResolvedValue({
        id: 'exec-1',
        status: 'running',
      })

      const res = await api('POST', '/api/ai/webhooks/doc-hook', {
        body,
        headers: { 'X-Webhook-Signature': `sha256=${sig}` },
        auth: false,
      })

      expect(res.status).toBe(202)
      expect(startExecution).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439022',
        TEST_USER,
        expect.objectContaining({ body }),
        { trigger: 'webhook' },
      )
    })

    it('verifyWebhookHmac matches BPMN style', () => {
      const secret = 's3cret'
      const payload = '{"documentId":"x"}'
      const sig = createHmac('sha256', secret).update(payload).digest('hex')
      expect(verifyWebhookHmac(secret, `sha256=${sig}`, payload)).toBe(true)
    })
  })

  describe('Line A — Chat: document API + attachment metadata shape', () => {
    beforeEach(async () => {
      const app = mountApp(documentRouter.routes())
      server = http.createServer(app.callback())
      await new Promise<void>((r) => server!.listen(0, r))
      const addr = server!.address() as { port: number }
      baseUrl = `http://127.0.0.1:${addr.port}`
    })

    it('upload via service produces id usable as documentAttachments', async () => {
      const buffer = Buffer.from('Chat 附件测试文档', 'utf-8')
      const doc = await createDocumentFromUpload(
        buffer,
        'chat.txt',
        'text/plain',
        TEST_USER,
        TEST_TENANT,
      )

      const attachmentMeta = {
        documentId: doc.id,
        filename: doc.filename,
        mimetype: doc.mimetype,
        size: doc.size,
        excerpt: doc.text.slice(0, 120),
      }

      expect(attachmentMeta.documentId).toMatch(/^[a-f0-9]{24}$/)
      expect(attachmentMeta.excerpt).toContain('Chat')

      const meta = await getDocumentPreview(doc.id, TEST_USER)
      expect(meta?.text).toContain('Chat')
    })

    it('GET preview returns text without stuffing into message content', async () => {
      const buffer = Buffer.from('preview only', 'utf-8')
      const doc = await createDocumentFromUpload(
        buffer,
        'p.txt',
        'text/plain',
        TEST_USER,
        TEST_TENANT,
      )

      const res = await api('GET', `/api/ai/documents/${doc.id}/preview`)
      expect(res.status).toBe(200)
      expect((res.body as { data: { text: string } }).data.text).toBe('preview only')
    })
  })
})
