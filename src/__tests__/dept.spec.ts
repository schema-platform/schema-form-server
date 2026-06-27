/**
 * Dept CRUD + Tree API Tests
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
import deptsRouter from '../routes/depts.js'
import { DeptModel } from '../models/Dept.js'
import { UserModel } from '../models/User.js'
import { connectDatabase, mongoose } from '../config/database.js'

const BASE = 'http://localhost:3004'

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
  app.use(deptsRouter.routes())
  app.use(deptsRouter.allowedMethods())

  await new Promise<void>((resolve) => {
    server = app.listen(3004, () => resolve())
  })
}, 30000)

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => { server!.close(() => resolve()) })
  }
  await mongoose.disconnect()
})

beforeEach(async () => {
  await DeptModel.deleteMany({})
  await UserModel.deleteMany({})
})

describe('Dept CRUD API', () => {
  // ── POST /api/depts ──

  it('POST /api/depts creates a root department', async () => {
    const { status, body } = await request('POST', '/api/depts', {
      name: '总公司',
    })

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.name).toBe('总公司')
    expect(body.data.parentId).toBeNull()
    expect(body.data.sort).toBe(0)
    expect(body.data.status).toBe('active')
    expect(body.data.leader).toBe('')
    expect(body.data.id).toBeDefined()
    expect(body.data.createdAt).toBeDefined()
  })

  it('POST /api/depts creates a child department', async () => {
    const parentId = uuidv4()
    await DeptModel.create({ _id: parentId, name: '总公司' })

    const { status, body } = await request('POST', '/api/depts', {
      name: '技术部',
      parentId,
      sort: 1,
      leader: '张三',
    })

    expect(status).toBe(201)
    expect(body.data.parentId).toBe(parentId)
    expect(body.data.sort).toBe(1)
    expect(body.data.leader).toBe('张三')
  })

  it('POST /api/depts validates required name', async () => {
    const { status, body } = await request('POST', '/api/depts', {})

    expect(status).toBe(400)
    expect(body.success).toBe(false)
  })

  it('POST /api/depts rejects non-existent parentId', async () => {
    const { status, body } = await request('POST', '/api/depts', {
      name: 'Test',
      parentId: '00000000-0000-0000-0000-000000000000',
    })

    expect(status).toBe(400)
    expect(body.error.message).toContain('Parent department not found')
  })

  it('POST /api/depts rejects duplicate name at same level', async () => {
    const rootId = uuidv4()
    await DeptModel.create({ _id: rootId, name: '总公司' })
    await DeptModel.create({ _id: uuidv4(), name: '技术部', parentId: rootId })

    const { status, body } = await request('POST', '/api/depts', {
      name: '技术部',
      parentId: rootId,
    })

    expect(status).toBe(409)
    expect(body.error.message).toContain('同名部门')
  })

  it('POST /api/depts allows same name under different parents', async () => {
    const rootA = uuidv4()
    const rootB = uuidv4()
    await DeptModel.create({ _id: rootA, name: 'A公司' })
    await DeptModel.create({ _id: rootB, name: 'B公司' })

    await request('POST', '/api/depts', { name: '技术部', parentId: rootA })
    const { status } = await request('POST', '/api/depts', { name: '技术部', parentId: rootB })

    expect(status).toBe(201)
  })

  // ── GET /api/depts ──

  it('GET /api/depts lists flat departments', async () => {
    const d1 = uuidv4()
    const d2 = uuidv4()
    await DeptModel.create({ _id: d1, name: 'A' })
    await DeptModel.create({ _id: d2, name: 'B', parentId: d1 })

    const { status, body } = await request('GET', '/api/depts')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.items).toHaveLength(2)
    expect(body.data.total).toBe(2)
  })

  it('GET /api/depts supports search', async () => {
    await DeptModel.create({ _id: uuidv4(), name: '技术部' })
    await DeptModel.create({ _id: uuidv4(), name: '市场部' })

    const { body } = await request('GET', '/api/depts?search=技术')

    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].name).toBe('技术部')
  })

  it('GET /api/depts supports status filter', async () => {
    await DeptModel.create({ _id: uuidv4(), name: 'Active', status: 'active' })
    await DeptModel.create({ _id: uuidv4(), name: 'Inactive', status: 'inactive' })

    const { body } = await request('GET', '/api/depts?status=active')

    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].status).toBe('active')
  })

  it('GET /api/depts supports parentId filter', async () => {
    const rootId = uuidv4()
    await DeptModel.create({ _id: rootId, name: 'Root' })
    await DeptModel.create({ _id: uuidv4(), name: 'Child', parentId: rootId })
    await DeptModel.create({ _id: uuidv4(), name: 'Other' })

    const { body } = await request('GET', `/api/depts?parentId=${rootId}`)

    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].name).toBe('Child')
  })

  // ── GET /api/depts?tree=true ──

  it('GET /api/depts?tree=true returns tree structure', async () => {
    const rootId = uuidv4()
    const techId = uuidv4()
    const hrId = uuidv4()
    const feId = uuidv4()
    const beId = uuidv4()

    await DeptModel.create({ _id: rootId, name: '总公司', sort: 0 })
    await DeptModel.create({ _id: techId, name: '技术部', parentId: rootId, sort: 2 })
    await DeptModel.create({ _id: hrId, name: '人事部', parentId: rootId, sort: 1 })
    await DeptModel.create({ _id: feId, name: '前端组', parentId: techId, sort: 1 })
    await DeptModel.create({ _id: beId, name: '后端组', parentId: techId, sort: 0 })

    const { status, body } = await request('GET', '/api/depts?tree=true')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    // Root level
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('总公司')
    // Children sorted by sort field (hr=1 before tech=2)
    expect(body.data[0].children).toHaveLength(2)
    expect(body.data[0].children[0].name).toBe('人事部')
    expect(body.data[0].children[1].name).toBe('技术部')
    // Grandchildren sorted by sort field (be=0 before fe=1)
    expect(body.data[0].children[1].children).toHaveLength(2)
    expect(body.data[0].children[1].children[0].name).toBe('后端组')
    expect(body.data[0].children[1].children[1].name).toBe('前端组')
  })

  it('GET /api/depts?tree=true with search filters before building tree', async () => {
    const rootId = uuidv4()
    await DeptModel.create({ _id: rootId, name: '总公司' })
    await DeptModel.create({ _id: uuidv4(), name: '技术部', parentId: rootId })
    await DeptModel.create({ _id: uuidv4(), name: '人事部', parentId: rootId })

    const { body } = await request('GET', '/api/depts?tree=true&search=技术')

    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('技术部')
  })

  // ── GET /api/depts/:id ──

  it('GET /api/depts/:id returns a department', async () => {
    const deptId = uuidv4()
    await DeptModel.create({ _id: deptId, name: '测试部' })

    const { status, body } = await request('GET', `/api/depts/${deptId}`)

    expect(status).toBe(200)
    expect(body.data.name).toBe('测试部')
  })

  it('GET /api/depts/:id returns 404 for missing dept', async () => {
    const { status, body } = await request('GET', '/api/depts/00000000-0000-0000-0000-000000000000')

    expect(status).toBe(404)
    expect(body.success).toBe(false)
  })

  it('GET /api/depts/:id rejects invalid UUID', async () => {
    const { status } = await request('GET', '/api/depts/not-a-uuid')

    expect(status).toBe(400)
  })

  // ── PUT /api/depts/:id ──

  it('PUT /api/depts/:id updates a department', async () => {
    const deptId = uuidv4()
    await DeptModel.create({ _id: deptId, name: 'Old Name' })

    const { status, body } = await request('PUT', `/api/depts/${deptId}`, { name: 'New Name', leader: '李四' })

    expect(status).toBe(200)
    expect(body.data.name).toBe('New Name')
    expect(body.data.leader).toBe('李四')
  })

  it('PUT /api/depts/:id rejects duplicate name at same level', async () => {
    const rootId = uuidv4()
    const aId = uuidv4()
    const bId = uuidv4()
    await DeptModel.create({ _id: rootId, name: 'Root' })
    await DeptModel.create({ _id: aId, name: 'A部', parentId: rootId })
    await DeptModel.create({ _id: bId, name: 'B部', parentId: rootId })

    const { status, body } = await request('PUT', `/api/depts/${bId}`, { name: 'A部' })

    expect(status).toBe(409)
    expect(body.error.message).toContain('同名部门')
  })

  it('PUT /api/depts/:id returns 404 for missing dept', async () => {
    const { status } = await request('PUT', '/api/depts/00000000-0000-0000-0000-000000000000', { name: 'Nope' })

    expect(status).toBe(404)
  })

  // ── PATCH /api/depts/:id/move ──

  it('PATCH /api/depts/:id/move moves to new parent', async () => {
    const rootId = uuidv4()
    const aId = uuidv4()
    const deptId = uuidv4()
    await DeptModel.create({ _id: rootId, name: 'Root' })
    await DeptModel.create({ _id: aId, name: 'A公司' })
    await DeptModel.create({ _id: deptId, name: '技术部', parentId: rootId })

    const { status, body } = await request('PATCH', `/api/depts/${deptId}/move`, { parentId: aId })

    expect(status).toBe(200)
    expect(body.data.parentId).toBe(aId)
  })

  it('PATCH /api/depts/:id/move moves to root', async () => {
    const rootId = uuidv4()
    const deptId = uuidv4()
    await DeptModel.create({ _id: rootId, name: 'Root' })
    await DeptModel.create({ _id: deptId, name: '技术部', parentId: rootId })

    const { status, body } = await request('PATCH', `/api/depts/${deptId}/move`, { parentId: null })

    expect(status).toBe(200)
    expect(body.data.parentId).toBeNull()
  })

  it('PATCH /api/depts/:id/move rejects self-referencing', async () => {
    const deptId = uuidv4()
    await DeptModel.create({ _id: deptId, name: 'Self' })

    const { status, body } = await request('PATCH', `/api/depts/${deptId}/move`, { parentId: deptId })

    expect(status).toBe(400)
    expect(body.error.message).toContain('under itself')
  })

  it('PATCH /api/depts/:id/move detects cycle', async () => {
    // A -> B -> C, try to move A under C (would create cycle)
    const aId = uuidv4()
    const bId = uuidv4()
    const cId = uuidv4()
    await DeptModel.create({ _id: aId, name: 'A', parentId: null })
    await DeptModel.create({ _id: bId, name: 'B', parentId: aId })
    await DeptModel.create({ _id: cId, name: 'C', parentId: bId })

    const { status, body } = await request('PATCH', `/api/depts/${aId}/move`, { parentId: cId })

    expect(status).toBe(400)
    expect(body.error.message).toContain('cycle')
  })

  it('PATCH /api/depts/:id/move rejects duplicate name at target level', async () => {
    const rootId = uuidv4()
    const aId = uuidv4()
    const techAId = uuidv4()
    const techBId = uuidv4()
    await DeptModel.create({ _id: rootId, name: 'Root' })
    await DeptModel.create({ _id: aId, name: 'A公司' })
    await DeptModel.create({ _id: techAId, name: '技术部', parentId: rootId })
    await DeptModel.create({ _id: techBId, name: '技术部', parentId: aId })

    const { status, body } = await request('PATCH', `/api/depts/${techAId}/move`, { parentId: aId })

    expect(status).toBe(409)
    expect(body.error.message).toContain('同名部门')
  })

  // ── DELETE /api/depts/:id ──

  it('DELETE /api/depts/:id deletes a leaf department', async () => {
    const deptId = uuidv4()
    await DeptModel.create({ _id: deptId, name: 'Delete Me' })

    const { status, body } = await request('DELETE', `/api/depts/${deptId}`)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toBeNull()

    const found = await DeptModel.findById(deptId)
    expect(found).toBeNull()
  })

  it('DELETE /api/depts/:id rejects if has children', async () => {
    const parentId = uuidv4()
    await DeptModel.create({ _id: parentId, name: 'Parent' })
    await DeptModel.create({ _id: uuidv4(), name: 'Child', parentId })

    const { status, body } = await request('DELETE', `/api/depts/${parentId}`)

    expect(status).toBe(400)
    expect(body.error.message).toContain('children')
  })

  it('DELETE /api/depts/:id rejects if has associated users', async () => {
    const deptId = uuidv4()
    await DeptModel.create({ _id: deptId, name: 'With Users' })
    await UserModel.create({ _id: uuidv4(), username: 'testuser', password: 'pass123', displayName: 'Test User', deptId })

    const { status, body } = await request('DELETE', `/api/depts/${deptId}`)

    expect(status).toBe(400)
    expect(body.error.message).toContain('associated users')
  })

  it('DELETE /api/depts/:id returns 404 for missing dept', async () => {
    const { status } = await request('DELETE', '/api/depts/00000000-0000-0000-0000-000000000000')

    expect(status).toBe(404)
  })

  // ── Response shape ──

  it('responses have consistent shape', async () => {
    const { body: listBody } = await request('GET', '/api/depts')
    expect(listBody).toHaveProperty('success')
    expect(listBody).toHaveProperty('data')
    expect(listBody.data).toHaveProperty('items')
    expect(listBody.data).toHaveProperty('total')

    const createRes = await request('POST', '/api/depts', { name: 'Shape' })
    expect(createRes.body).toHaveProperty('success')
    expect(createRes.body).toHaveProperty('data')
  })
})
