import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { CredentialModel } from '../models/Credential.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { encrypt, decrypt } from '../services/credentialService.js'
import { createCredentialSchema, updateCredentialSchema } from '../schemas/credentialSchemas.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/credentials' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ────────────────────────────────────────────
// GET /api/credentials
// List credentials (data field excluded for security)
// ────────────────────────────────────────────
router.get('/', requireAuth, async (ctx) => {
  const { search, type, page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query
  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (search) filter.name = { $regex: escapeRegex(search as string), $options: 'i' }
  if (type && ['api_key', 'basic_auth', 'bearer_token'].includes(type as string)) filter.type = type

  const [items, total] = await Promise.all([
    CredentialModel.find(filter, { data: 0 }).skip(skip).limit(pageSize).sort({ updatedAt: -1 }),
    CredentialModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// ────────────────────────────────────────────
// POST /api/credentials
// Create a new credential (data is encrypted before storage)
// ────────────────────────────────────────────
router.post('/', requireAuth, requirePermission('credential:create'), validate(createCredentialSchema), async (ctx) => {
  const { name, type, data } = ctx.request.body as {
    name: string; type: string; data: Record<string, string>
  }

  const userId = (ctx.state.user as { id: string }).id
  const encryptedData = encrypt(data)

  const credential = await CredentialModel.create({
    _id: uuidv4(),
    name: name.trim(),
    type,
    data: encryptedData,
    createdBy: userId,
  })

  ctx.status = 201
  ctx.body = { success: true, data: credential }
})

// ────────────────────────────────────────────
// GET /api/credentials/:id
// Get credential detail (data field decrypted)
// ────────────────────────────────────────────
router.get('/:id', requireAuth, async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const credential = await CredentialModel.findById(id)

  if (!credential) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Credential not found.' } }
    return
  }

  const decryptedData = decrypt(credential.data)

  ctx.body = {
    success: true,
    data: {
      id: credential._id,
      name: credential.name,
      type: credential.type,
      data: decryptedData,
      tenantId: credential.tenantId,
      createdBy: credential.createdBy,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    },
  }
})

// ────────────────────────────────────────────
// PUT /api/credentials/:id
// Update credential
// ────────────────────────────────────────────
router.put('/:id', requireAuth, requirePermission('credential:edit'), validate(updateCredentialSchema), async (ctx) => {
  const { id } = ctx.params
  const { name, type, data } = ctx.request.body as {
    name?: string; type?: string; data?: Record<string, string>
  }

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await CredentialModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Credential not found.' } }
    return
  }

  const update: Record<string, unknown> = {}
  if (name !== undefined) update.name = name.trim()
  if (type !== undefined) update.type = type
  if (data !== undefined) update.data = encrypt(data)

  const credential = await CredentialModel.findByIdAndUpdate(id, update, { new: true })

  ctx.body = { success: true, data: credential }
})

// ────────────────────────────────────────────
// DELETE /api/credentials/:id
// ────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('credential:delete'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await CredentialModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Credential not found.' } }
    return
  }

  await CredentialModel.findByIdAndDelete(id)

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

export default router
