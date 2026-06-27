/**
 * Menu CRUD + Tree + Route API Tests
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
import menusRouter from '../routes/menus.js'
import { MenuModel } from '../models/Menu.js'
import { RoleModel } from '../models/Role.js'
import { UserModel } from '../models/User.js'
import { connectDatabase, mongoose } from '../config/database.js'

const BASE = 'http://localhost:3007'

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
  app.use(menusRouter.routes())
  app.use(menusRouter.allowedMethods())

  await new Promise<void>((resolve) => {
    server = app.listen(3007, () => resolve())
  })
}, 30000)

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => { server!.close(() => resolve()) })
  }
  await mongoose.disconnect()
})

beforeEach(async () => {
  await MenuModel.deleteMany({})
  await RoleModel.deleteMany({})
  await UserModel.deleteMany({})
})

describe('Menu CRUD API', () => {
  // ── POST /api/menus ──

  it('POST /api/menus creates a root menu', async () => {
    const { status, body } = await request('POST', '/api/menus', {
      name: '系统管理',
      path: '/system',
      icon: 'setting',
    })

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.name).toBe('系统管理')
    expect(body.data.path).toBe('/system')
    expect(body.data.icon).toBe('setting')
    expect(body.data.type).toBe('menu')
    expect(body.data.status).toBe('active')
    expect(body.data.sort).toBe(0)
    expect(body.data.parentId).toBeNull()
    expect(body.data.id).toBeDefined()
    expect(body.data.createdAt).toBeDefined()
  })

  it('POST /api/menus creates a child menu', async () => {
    const parentId = uuidv4()
    await MenuModel.create({ _id: parentId, name: '系统管理' })

    const { status, body } = await request('POST', '/api/menus', {
      name: '用户管理',
      parentId,
      path: '/system/users',
      component: 'system/Users',
      sort: 1,
    })

    expect(status).toBe(201)
    expect(body.data.parentId).toBe(parentId)
    expect(body.data.sort).toBe(1)
    expect(body.data.component).toBe('system/Users')
  })

  it('POST /api/menus creates a button type', async () => {
    const { status, body } = await request('POST', '/api/menus', {
      name: '新增用户',
      type: 'button',
      permission: 'system:user:add',
    })

    expect(status).toBe(201)
    expect(body.data.type).toBe('button')
    expect(body.data.permission).toBe('system:user:add')
  })

  it('POST /api/menus validates required name', async () => {
    const { status, body } = await request('POST', '/api/menus', {})

    expect(status).toBe(400)
    expect(body.success).toBe(false)
  })

  it('POST /api/menus rejects non-existent parentId', async () => {
    const { status, body } = await request('POST', '/api/menus', {
      name: 'Test',
      parentId: '00000000-0000-0000-0000-000000000000',
    })

    expect(status).toBe(400)
    expect(body.error.message).toContain('Parent menu not found')
  })

  it('POST /api/menus rejects invalid type', async () => {
    const { status, body } = await request('POST', '/api/menus', {
      name: 'Test',
      type: 'invalid',
    })

    expect(status).toBe(400)
    expect(body.success).toBe(false)
  })

  // ── GET /api/menus ──

  it('GET /api/menus lists flat menus', async () => {
    const m1 = uuidv4()
    const m2 = uuidv4()
    await MenuModel.create({ _id: m1, name: 'A' })
    await MenuModel.create({ _id: m2, name: 'B', parentId: m1 })

    const { status, body } = await request('GET', '/api/menus')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.items).toHaveLength(2)
    expect(body.data.total).toBe(2)
  })

  it('GET /api/menus supports search', async () => {
    await MenuModel.create({ _id: uuidv4(), name: '系统管理' })
    await MenuModel.create({ _id: uuidv4(), name: '用户管理' })

    const { body } = await request('GET', '/api/menus?search=系统')

    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].name).toBe('系统管理')
  })

  it('GET /api/menus supports type filter', async () => {
    await MenuModel.create({ _id: uuidv4(), name: '菜单', type: 'menu' })
    await MenuModel.create({ _id: uuidv4(), name: '按钮', type: 'button' })

    const { body } = await request('GET', '/api/menus?type=button')

    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].type).toBe('button')
  })

  it('GET /api/menus supports status filter', async () => {
    await MenuModel.create({ _id: uuidv4(), name: 'Active', status: 'active' })
    await MenuModel.create({ _id: uuidv4(), name: 'Inactive', status: 'inactive' })

    const { body } = await request('GET', '/api/menus?status=active')

    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].status).toBe('active')
  })

  it('GET /api/menus supports parentId filter', async () => {
    const rootId = uuidv4()
    await MenuModel.create({ _id: rootId, name: 'Root' })
    await MenuModel.create({ _id: uuidv4(), name: 'Child', parentId: rootId })
    await MenuModel.create({ _id: uuidv4(), name: 'Other' })

    const { body } = await request('GET', `/api/menus?parentId=${rootId}`)

    expect(body.data.items).toHaveLength(1)
    expect(body.data.items[0].name).toBe('Child')
  })

  // ── GET /api/menus?tree=true ──

  it('GET /api/menus?tree=true returns tree structure', async () => {
    const rootId = uuidv4()
    const userId = uuidv4()
    const roleId = uuidv4()
    const btn1Id = uuidv4()
    const btn2Id = uuidv4()

    await MenuModel.create({ _id: rootId, name: '系统管理', sort: 0 })
    await MenuModel.create({ _id: userId, name: '用户管理', parentId: rootId, sort: 2 })
    await MenuModel.create({ _id: roleId, name: '角色管理', parentId: rootId, sort: 1 })
    await MenuModel.create({ _id: btn1Id, name: '新增用户', parentId: userId, type: 'button', sort: 1 })
    await MenuModel.create({ _id: btn2Id, name: '删除用户', parentId: userId, type: 'button', sort: 0 })

    const { status, body } = await request('GET', '/api/menus?tree=true')

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    // Root level
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('系统管理')
    // Children sorted by sort field
    expect(body.data[0].children).toHaveLength(2)
    expect(body.data[0].children[0].name).toBe('角色管理')
    expect(body.data[0].children[1].name).toBe('用户管理')
    // Buttons under user management
    expect(body.data[0].children[1].children).toHaveLength(2)
    expect(body.data[0].children[1].children[0].name).toBe('删除用户')
    expect(body.data[0].children[1].children[1].name).toBe('新增用户')
  })

  it('GET /api/menus?tree=true with search filters before building tree', async () => {
    const rootId = uuidv4()
    await MenuModel.create({ _id: rootId, name: '系统管理' })
    await MenuModel.create({ _id: uuidv4(), name: '用户管理', parentId: rootId })
    await MenuModel.create({ _id: uuidv4(), name: '角色管理', parentId: rootId })

    const { body } = await request('GET', '/api/menus?tree=true&search=用户')

    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('用户管理')
  })

  // ── GET /api/menus/:id ──

  it('GET /api/menus/:id returns a menu', async () => {
    const id = uuidv4()
    await MenuModel.create({ _id: id, name: '测试菜单' })

    const { status, body } = await request('GET', `/api/menus/${id}`)

    expect(status).toBe(200)
    expect(body.data.name).toBe('测试菜单')
  })

  it('GET /api/menus/:id returns 404 for missing menu', async () => {
    const { status, body } = await request('GET', '/api/menus/00000000-0000-0000-0000-000000000000')

    expect(status).toBe(404)
    expect(body.success).toBe(false)
  })

  it('GET /api/menus/:id rejects invalid UUID', async () => {
    const { status } = await request('GET', '/api/menus/not-a-uuid')

    expect(status).toBe(400)
  })

  // ── PUT /api/menus/:id ──

  it('PUT /api/menus/:id updates a menu', async () => {
    const id = uuidv4()
    await MenuModel.create({ _id: id, name: 'Old Name' })

    const { status, body } = await request('PUT', `/api/menus/${id}`, { name: 'New Name', icon: 'user' })

    expect(status).toBe(200)
    expect(body.data.name).toBe('New Name')
    expect(body.data.icon).toBe('user')
  })

  it('PUT /api/menus/:id returns 404 for missing menu', async () => {
    const { status } = await request('PUT', '/api/menus/00000000-0000-0000-0000-000000000000', { name: 'Nope' })

    expect(status).toBe(404)
  })

  it('PUT /api/menus/:id rejects self-referencing parentId', async () => {
    const id = uuidv4()
    await MenuModel.create({ _id: id, name: 'Self' })

    const { status, body } = await request('PUT', `/api/menus/${id}`, { parentId: id })

    expect(status).toBe(400)
    expect(body.error.message).toContain('its own parent')
  })

  it('PUT /api/menus/:id detects cycle', async () => {
    const aId = uuidv4()
    const bId = uuidv4()
    const cId = uuidv4()
    await MenuModel.create({ _id: aId, name: 'A', parentId: null })
    await MenuModel.create({ _id: bId, name: 'B', parentId: aId })
    await MenuModel.create({ _id: cId, name: 'C', parentId: bId })

    const { status, body } = await request('PUT', `/api/menus/${aId}`, { parentId: cId })

    expect(status).toBe(400)
    expect(body.error.message).toContain('cycle')
  })

  // ── DELETE /api/menus/:id ──

  it('DELETE /api/menus/:id deletes a leaf menu', async () => {
    const id = uuidv4()
    await MenuModel.create({ _id: id, name: 'Delete Me' })

    const { status, body } = await request('DELETE', `/api/menus/${id}`)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toBeNull()

    const found = await MenuModel.findById(id)
    expect(found).toBeNull()
  })

  it('DELETE /api/menus/:id rejects if has children', async () => {
    const parentId = uuidv4()
    await MenuModel.create({ _id: parentId, name: 'Parent' })
    await MenuModel.create({ _id: uuidv4(), name: 'Child', parentId })

    const { status, body } = await request('DELETE', `/api/menus/${parentId}`)

    expect(status).toBe(400)
    expect(body.error.message).toContain('children')
  })

  it('DELETE /api/menus/:id returns 404 for missing menu', async () => {
    const { status } = await request('DELETE', '/api/menus/00000000-0000-0000-0000-000000000000')

    expect(status).toBe(404)
  })

  // ── Response shape ──

  it('responses have consistent shape', async () => {
    const { body: listBody } = await request('GET', '/api/menus')
    expect(listBody).toHaveProperty('success')
    expect(listBody).toHaveProperty('data')
    expect(listBody.data).toHaveProperty('items')
    expect(listBody.data).toHaveProperty('total')

    const createRes = await request('POST', '/api/menus', { name: 'Shape' })
    expect(createRes.body).toHaveProperty('success')
    expect(createRes.body).toHaveProperty('data')
  })
})

describe('GET /api/menus/route — dynamic route tree', () => {
  beforeEach(async () => {
    // Create dev user that auth middleware falls back to in non-production
    await UserModel.create({
      _id: 'dev',
      username: 'dev',
      password: 'dev',
      displayName: 'Dev User',
      roles: [],
      tenantId: '000000',
      status: 'active',
    })
  })

  it('returns empty tree when no menus exist', async () => {
    const { status, body } = await request('GET', '/api/menus/route')

    // In dev mode, auth is skipped so we get a valid response
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual([])
  })

  it('returns only menu type items (not buttons)', async () => {
    await MenuModel.create({ _id: uuidv4(), name: 'Dashboard', type: 'menu', path: '/dashboard', status: 'active' })
    await MenuModel.create({ _id: uuidv4(), name: 'Add Button', type: 'button', permission: 'add', status: 'active' })

    const { body } = await request('GET', '/api/menus/route')

    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('Dashboard')
  })

  it('excludes inactive menus', async () => {
    await MenuModel.create({ _id: uuidv4(), name: 'Active', type: 'menu', status: 'active' })
    await MenuModel.create({ _id: uuidv4(), name: 'Inactive', type: 'menu', status: 'inactive' })

    const { body } = await request('GET', '/api/menus/route')

    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('Active')
  })

  it('includes parent menus needed for tree structure', async () => {
    const parentId = uuidv4()
    const childId = uuidv4()
    // Parent has permission, child has no permission
    await MenuModel.create({ _id: parentId, name: 'System', type: 'menu', permission: 'admin', status: 'active' })
    await MenuModel.create({ _id: childId, name: 'Settings', type: 'menu', parentId, path: '/settings', status: 'active' })

    // In dev mode, all permissions are available, so both should be visible
    const { body } = await request('GET', '/api/menus/route')

    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('System')
    expect(body.data[0].children).toHaveLength(1)
    expect(body.data[0].children[0].name).toBe('Settings')
  })

  it('returns tree structure sorted by sort field', async () => {
    const rootId = uuidv4()
    const aId = uuidv4()
    const bId = uuidv4()
    await MenuModel.create({ _id: rootId, name: 'Root', type: 'menu', sort: 0, status: 'active' })
    await MenuModel.create({ _id: aId, name: 'A', type: 'menu', parentId: rootId, sort: 2, status: 'active' })
    await MenuModel.create({ _id: bId, name: 'B', type: 'menu', parentId: rootId, sort: 1, status: 'active' })

    const { body } = await request('GET', '/api/menus/route')

    expect(body.data).toHaveLength(1)
    expect(body.data[0].children).toHaveLength(2)
    expect(body.data[0].children[0].name).toBe('B')
    expect(body.data[0].children[1].name).toBe('A')
  })

  it('menus without permission are visible to all', async () => {
    await MenuModel.create({ _id: uuidv4(), name: 'Public', type: 'menu', path: '/public', permission: '', status: 'active' })

    const { body } = await request('GET', '/api/menus/route')

    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('Public')
  })
})
