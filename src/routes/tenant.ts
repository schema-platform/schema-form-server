import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { TenantModel } from '../models/Tenant.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createTenantSchema, updateTenantSchema } from '../schemas/tenantSchemas.js'
import { initTenantData } from '../utils/tenantInit.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/tenants' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ────────────────────────────────────────────
// GET /api/tenants
// Lists tenants with optional search and status filter.
// ────────────────────────────────────────────
router.get('/', requireAuth, requirePermission('tenant:view'), async (ctx) => {
  const { search, status, page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query
  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (search) {
    filter.$or = [
      { name: { $regex: escapeRegex(search as string), $options: 'i' } },
      { code: { $regex: escapeRegex(search as string), $options: 'i' } },
    ]
  }
  if (status && ['active', 'inactive', 'suspended'].includes(status as string)) {
    filter.status = status as string
  }

  const [items, total] = await Promise.all([
    TenantModel.find(filter).skip(skip).limit(pageSize).sort({ createdAt: -1 }),
    TenantModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items: items.map((item) => item.toJSON()),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// ────────────────────────────────────────────
// GET /api/tenants/:id
// ────────────────────────────────────────────
router.get('/:id', requireAuth, requirePermission('tenant:view'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const tenant = await TenantModel.findById(id)
  if (!tenant) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Tenant not found.' } }
    return
  }

  ctx.body = { success: true, data: tenant.toJSON() }
})

// ────────────────────────────────────────────
// POST /api/tenants
// ────────────────────────────────────────────
router.post('/', requireAuth, requirePermission('tenant:create'), validate(createTenantSchema), async (ctx) => {
  const { name, code, status, config } = ctx.request.body as {
    name: string
    code: string
    status?: string
    config?: { maxUsers?: number; features?: string[] }
  }

  const existing = await TenantModel.findOne({ code })
  if (existing) {
    ctx.status = 409
    ctx.body = { success: false, error: { message: 'Tenant code already exists.' } }
    return
  }

  const tenant = await TenantModel.create({
    _id: uuidv4(),
    name,
    code,
    status: status || 'active',
    config: {
      maxUsers: config?.maxUsers ?? 100,
      features: config?.features ?? [],
    },
  })

  // Initialize tenant with default roles, admin user, and menus (non-blocking)
  initTenantData(tenant._id, name).catch((err: unknown) => {
    console.error('[tenant] Failed to init tenant data:', err instanceof Error ? err.message : String(err))
  })

  ctx.status = 201
  ctx.body = { success: true, data: tenant.toJSON() }
})

// ────────────────────────────────────────────
// PUT /api/tenants/:id
// ────────────────────────────────────────────
router.put('/:id', requireAuth, requirePermission('tenant:edit'), validate(updateTenantSchema), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const { name, code, status, config } = ctx.request.body as {
    name?: string
    code?: string
    status?: string
    config?: { maxUsers?: number; features?: string[] }
  }

  const existing = await TenantModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Tenant not found.' } }
    return
  }

  if (code && code !== existing.code) {
    const duplicate = await TenantModel.findOne({ code, _id: { $ne: id } })
    if (duplicate) {
      ctx.status = 409
      ctx.body = { success: false, error: { message: 'Tenant code already exists.' } }
      return
    }
  }

  const update: Record<string, unknown> = {}
  if (name !== undefined) update.name = name
  if (code !== undefined) update.code = code
  if (status !== undefined) update.status = status
  if (config !== undefined) {
    update.config = {
      ...(config.maxUsers !== undefined ? { maxUsers: config.maxUsers } : {}),
      ...(config.features !== undefined ? { features: config.features } : {}),
    }
  }

  const tenant = await TenantModel.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true })

  ctx.body = { success: true, data: tenant!.toJSON() }
})

// ────────────────────────────────────────────
// DELETE /api/tenants/:id
// ────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('tenant:delete'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await TenantModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Tenant not found.' } }
    return
  }

  await TenantModel.findByIdAndDelete(id)

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

export default router
