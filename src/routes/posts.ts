import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { PostModel } from '../models/Post.js'
import { UserModel } from '../models/User.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createPostSchema, updatePostSchema } from '../schemas/postSchemas.js'
import { getCurrentTenantId } from '../middleware/tenantContext.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/posts' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ────────────────────────────────────────────
// GET /api/posts
// Lists posts with pagination, search, and status filter.
// ────────────────────────────────────────────
router.get('/', requireAuth, requirePermission('post:view'), async (ctx) => {
  const { search, status, page: pageStr, pageSize: pageSizeStr } = ctx.query

  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 10))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (search) {
    const regex = { $regex: escapeRegex(search as string), $options: 'i' }
    filter.$or = [{ postName: regex }, { postCode: regex }]
  }
  if (status && ['active', 'inactive'].includes(status as string)) {
    filter.status = status as string
  }

  const [items, total] = await Promise.all([
    PostModel.find(filter).sort({ sort: 1, createdAt: -1 }).skip(skip).limit(pageSize),
    PostModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items: items.map((p) => p.toJSON()),
      total,
      page,
      pageSize,
    },
  }
})

// ────────────────────────────────────────────
// GET /api/posts/all
// Returns all posts (for dropdowns/selectors).
// ────────────────────────────────────────────
router.get('/all', requireAuth, requirePermission('post:view'), async (ctx) => {
  const posts = await PostModel.find({ status: 'active' }).sort({ sort: 1 })
  ctx.body = { success: true, data: posts.map((p) => p.toJSON()) }
})

// ────────────────────────────────────────────
// GET /api/posts/:id
// ────────────────────────────────────────────
router.get('/:id', requireAuth, requirePermission('post:view'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const post = await PostModel.findById(id)
  if (!post) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Post not found.' } }
    return
  }

  ctx.body = { success: true, data: post.toJSON() }
})

// ────────────────────────────────────────────
// POST /api/posts
// Creates a post. Validates unique postCode within tenant.
// ────────────────────────────────────────────
router.post('/', requireAuth, requirePermission('post:create'), validate(createPostSchema), async (ctx) => {
  const { postCode, postName, sort, status, remark } = ctx.request.body as {
    postCode: string
    postName: string
    sort: number
    status: string
    remark: string
  }

  // Check duplicate postCode within tenant
  const tenantId = getCurrentTenantId()
  const codeFilter: Record<string, unknown> = { postCode }
  if (tenantId) codeFilter.tenantId = tenantId
  const existingCode = await PostModel.findOne(codeFilter)
  if (existingCode) {
    ctx.status = 409
    ctx.body = { success: false, error: { message: '岗位编码已存在。' } }
    return
  }

  // Check duplicate postName within tenant
  const nameFilter: Record<string, unknown> = { postName }
  if (tenantId) nameFilter.tenantId = tenantId
  const existingName = await PostModel.findOne(nameFilter)
  if (existingName) {
    ctx.status = 409
    ctx.body = { success: false, error: { message: '岗位名称已存在。' } }
    return
  }

  const post = await PostModel.create({
    _id: uuidv4(),
    postCode,
    postName,
    sort,
    status,
    remark,
  })

  ctx.status = 201
  ctx.body = { success: true, data: post.toJSON() }
})

// ────────────────────────────────────────────
// PUT /api/posts/:id
// ────────────────────────────────────────────
router.put('/:id', requireAuth, requirePermission('post:edit'), validate(updatePostSchema), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await PostModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Post not found.' } }
    return
  }

  const body = ctx.request.body as Record<string, unknown>

  // Check duplicate postCode if changed
  if (body.postCode && body.postCode !== existing.postCode) {
    const tenantId = getCurrentTenantId()
    const codeFilter: Record<string, unknown> = { postCode: body.postCode, _id: { $ne: id } }
    if (tenantId) codeFilter.tenantId = tenantId
    const dup = await PostModel.findOne(codeFilter)
    if (dup) {
      ctx.status = 409
      ctx.body = { success: false, error: { message: '岗位编码已存在。' } }
      return
    }
  }

  // Check duplicate postName if changed
  if (body.postName && body.postName !== existing.postName) {
    const tenantId = getCurrentTenantId()
    const nameFilter: Record<string, unknown> = { postName: body.postName, _id: { $ne: id } }
    if (tenantId) nameFilter.tenantId = tenantId
    const dup = await PostModel.findOne(nameFilter)
    if (dup) {
      ctx.status = 409
      ctx.body = { success: false, error: { message: '岗位名称已存在。' } }
      return
    }
  }

  const update: Record<string, unknown> = {}
  if (body.postCode !== undefined) update.postCode = body.postCode
  if (body.postName !== undefined) update.postName = body.postName
  if (body.sort !== undefined) update.sort = body.sort
  if (body.status !== undefined) update.status = body.status
  if (body.remark !== undefined) update.remark = body.remark

  const post = await PostModel.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true })

  ctx.body = { success: true, data: post!.toJSON() }
})

// ────────────────────────────────────────────
// DELETE /api/posts/:id
// Deletes a post. Rejects if users are assigned to it.
// ────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('post:delete'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await PostModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Post not found.' } }
    return
  }

  // Check for associated users
  const userCount = await UserModel.countDocuments({ postId: id })
  if (userCount > 0) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: '该岗位下存在用户，无法删除。请先解除关联。' } }
    return
  }

  await PostModel.findByIdAndDelete(id)

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

export default router
