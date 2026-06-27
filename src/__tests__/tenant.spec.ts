/**
 * Tenant CRUD API Tests
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import Koa from 'koa'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'
import { v4 as uuidv4 } from 'uuid'
import { errorHandler } from '../middleware/errorHandler.js'
import tenantRouter from '../routes/tenant.js'
import { TenantModel } from '../models/Tenant.js'
import { connectDatabase, mongoose } from '../config/database.js'

const BASE = 'http://localhost:3006'

let server: ReturnType<typeof http.createServer> | null = null

function request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE)
    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode ?? 0, body: data.substring(0, 500) }) }
      })
    })

    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

beforeAll(async () => {
  await connectDatabase()

  const app = new Koa()
  app.use(errorHandler)
  app.use(bodyParser())
  app.use(cors({ origin: () => '' }))
  app.use(tenantRouter.routes())
  app.use(tenantRouter.allowedMethods())

  await new Promise<void>((resolve) => {
    server = app.listen(3006, () => resolve())
  })
}, 30000)

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => { server!.close(() => resolve()) })
  }
  await mongoose.disconnect()
})

beforeEach(async () => {
  await TenantModel.deleteMany({})
})

describe('Tenant CRUD API', () => {
  // ── POST /api/tenants ──

  it('POST /api/tenants creates a tenant', async () => {
    const { status, body } = await request('POST', '/api/tenants', {
      name: 'Test Tenant',
      code: 'test-tenant',
    })

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.name).toBe('Test Tenant')
    expect(body.data.code).toBe('test-tenant')
    expect(body.data.status).toBe('active')
    expect(body.data.config.maxUsers).toBe(100)
    expect(body.data.config.features).toEqual([])
    expect(body.data.id).toBeDefined()
    expect(body.data.createdAt).toBeDefined()
  })

  it('POST /api/tenants with full config', async () => {
    const { status, body } = await request('POST', '/api/tenants', {
      name: 'Full Tenant',
      code: 'full-tenant',
      status: 'inactive',
      config: { maxUsers: 500, features: ['ai', 'flow'] },
    })

    expect(status).toBe(201)
    expect(body.data.status).toBe('inactive')
    expect(body.data.config.maxUsers).toBe(500)
    expect(body.data.config.features).toEqual(['ai', 'flow'])
  })

  it('POST /api/tenants rejects duplicate code', async () => {
    await request('POST', '/api/tenants', { name: 'First', code: 'dup-code' })
    const { status, body } = await request('POST', '/api/tenants', { name: 'Second', code: 'dup-code' })

    expect(status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.error.message).toContain('already exists')
  })

  it('POST /api/tenants validates required fields', async () => {
    const { status, body } = await request('POST', '/api/tenants', {})

    expect(status).toBe(400)
    expect(body.success).toBe(false)
  })

  it('POST /api/tenants validates code format', async () => {
    const { status, body } = await request('POST', '/api/tenants', { name: 'Test', code: 'invalid code!' })

    expect(status).toBe(400)
    expect(body.success).toBe(false)
  })

  // ── GET /api/tenants ──

  it('GET /api/tenants lists tenants with pagination', async () => {
    await TenantModel.create({ _id: uuidv4(), name: 'Alpha', code: 'alpha', status: 'active' })
    await TenantModel.create({ _id: uuidv4(), name: 'Beta', code: 'beta', status: 'inactive' })

    const { status, body } = await request('GET', '/api/tenants?page=1&pageSize=10')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.items).toHaveLength(2)
    expect(body.data.total).toBe(2)
    expect(body.data.page).toBe(1)
    expect(body.data.pageSize).toBe(10)
    expect(body.data.totalPages).toBe(1)
  })

  it('GET /api/tenants supports search', async () => {
    await TenantModel.create({ _id: uuidv4(), name: 'Production', code: 'prod' })
    await TenantModel.create({ _id: uuidv4(), name: 'Staging', code: 'staging' })

    const { body } = await request('GET', '/api/tenants?search=prod')

    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].code).toBe('prod')
  })

  it('GET /api/tenants supports status filter', async () => {
    await TenantModel.create({ _id: uuidv4(), name: 'Active', code: 'active-t', status: 'active' })
    await TenantModel.create({ _id: uuidv4(), name: 'Inactive', code: 'inactive-t', status: 'inactive' })

    const { body } = await request('GET', '/api/tenants?status=active')

    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].status).toBe('active')
  })

  // ── GET /api/tenants/:id ──

  it('GET /api/tenants/:id returns a tenant', async () => {
    const id = uuidv4()
    await TenantModel.create({ _id: id, name: 'Test', code: 'test-get' })

    const { status, body } = await request('GET', `/api/tenants/${id}`)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.name).toBe('Test')
  })

  it('GET /api/tenants/:id returns 404 for missing tenant', async () => {
    const { status, body } = await request('GET', '/api/tenants/00000000-0000-0000-0000-000000000000')

    expect(status).toBe(404)
    expect(body.success).toBe(false)
  })

  it('GET /api/tenants/:id rejects invalid UUID', async () => {
    const { status } = await request('GET', '/api/tenants/not-a-uuid')

    expect(status).toBe(400)
  })

  // ── PUT /api/tenants/:id ──

  it('PUT /api/tenants/:id updates a tenant', async () => {
    const id = uuidv4()
    await TenantModel.create({ _id: id, name: 'Old Name', code: 'old-code' })

    const { status, body } = await request('PUT', `/api/tenants/${id}`, { name: 'New Name' })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.name).toBe('New Name')
    expect(body.data.code).toBe('old-code')
  })

  it('PUT /api/tenants/:id updates config partially', async () => {
    const id = uuidv4()
    await TenantModel.create({
      _id: id,
      name: 'Config Test',
      code: 'config-test',
      config: { maxUsers: 100, features: ['a'] },
    })

    const { status, body } = await request('PUT', `/api/tenants/${id}`, {
      config: { maxUsers: 500 },
    })

    expect(status).toBe(200)
    expect(body.data.config.maxUsers).toBe(500)
  })

  it('PUT /api/tenants/:id rejects duplicate code', async () => {
    const idA = uuidv4()
    const idB = uuidv4()
    await TenantModel.create({ _id: idA, name: 'A', code: 'code-a' })
    await TenantModel.create({ _id: idB, name: 'B', code: 'code-b' })

    const { status, body } = await request('PUT', `/api/tenants/${idB}`, { code: 'code-a' })

    expect(status).toBe(409)
    expect(body.error.message).toContain('already exists')
  })

  it('PUT /api/tenants/:id returns 404 for missing tenant', async () => {
    const { status } = await request('PUT', '/api/tenants/00000000-0000-0000-0000-000000000000', { name: 'Nope' })

    expect(status).toBe(404)
  })

  // ── DELETE /api/tenants/:id ──

  it('DELETE /api/tenants/:id deletes a tenant', async () => {
    const id = uuidv4()
    await TenantModel.create({ _id: id, name: 'Delete Me', code: 'del-me' })

    const { status, body } = await request('DELETE', `/api/tenants/${id}`)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toBeNull()

    const found = await TenantModel.findById(id)
    expect(found).toBeNull()
  })

  it('DELETE /api/tenants/:id returns 404 for missing tenant', async () => {
    const { status } = await request('DELETE', '/api/tenants/00000000-0000-0000-0000-000000000000')

    expect(status).toBe(404)
  })

  // ── Response shape ──

  it('responses have consistent shape', async () => {
    const { body: listBody } = await request('GET', '/api/tenants')
    expect(listBody).toHaveProperty('success')
    expect(listBody).toHaveProperty('data')
    expect(listBody.data).toHaveProperty('items')
    expect(listBody.data).toHaveProperty('total')

    const createRes = await request('POST', '/api/tenants', { name: 'Shape', code: 'shape' })
    expect(createRes.body).toHaveProperty('success')
    expect(createRes.body).toHaveProperty('data')
  })
})

describe('Default Tenant Initialization', () => {
  it('initDefaultTenant creates default tenant when none exists', async () => {
    const { initDefaultTenant, DEFAULT_TENANT_ID } = await import('../utils/initDefaultTenant.js')
    await initDefaultTenant()

    const tenant = await TenantModel.findById(DEFAULT_TENANT_ID)
    expect(tenant).not.toBeNull()
    expect(tenant!.code).toBe('default')
    expect(tenant!.name).toBe('默认租户')
    expect(tenant!.status).toBe('active')
    expect(tenant!.config.maxUsers).toBe(10000)
    expect(tenant!.config.features).toEqual(['*'])
  })

  it('initDefaultTenant is idempotent', async () => {
    const { initDefaultTenant } = await import('../utils/initDefaultTenant.js')
    await initDefaultTenant()
    await initDefaultTenant()

    const count = await TenantModel.countDocuments({ code: 'default' })
    expect(count).toBe(1)
  })
})
