import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { DeptModel } from '../models/Dept.js'
import { UserModel } from '../models/User.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createDeptSchema, updateDeptSchema, moveDeptSchema } from '../schemas/deptSchemas.js'
import { getCurrentTenantId } from '../middleware/tenantContext.js'

const requireAuth = authMiddleware({ required: true })
const router = new Router({ prefix: '/api/depts' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a tree structure from flat dept list.
 * Depts with parentId=null (or not found in the set) become root nodes.
 */
function buildTree(depts: Record<string, unknown>[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>()
  const roots: Record<string, unknown>[] = []

  // Index all depts by id
  for (const dept of depts) {
    map.set(dept.id as string, { ...dept, children: [] })
  }

  // Wire children to parents
  for (const dept of depts) {
    const node = map.get(dept.id as string)!
    const parentId = dept.parentId as string | null
    if (parentId && map.has(parentId)) {
      const parent = map.get(parentId)!
      ;(parent.children as Record<string, unknown>[]).push(node)
    } else {
      roots.push(node)
    }
  }

  // Sort children recursively by `sort` field
  function sortChildren(nodes: Record<string, unknown>[]): void {
    nodes.sort((a, b) => ((a.sort as number) ?? 0) - ((b.sort as number) ?? 0))
    for (const node of nodes) {
      sortChildren(node.children as Record<string, unknown>[])
    }
  }

  sortChildren(roots)
  return roots
}

// ────────────────────────────────────────────
// GET /api/depts
// Lists depts. Supports ?tree=true for tree structure,
// plus search, status filter, and parentId filter.
// ────────────────────────────────────────────
router.get('/', requireAuth, requirePermission('dept:view'), async (ctx) => {
  const { search, status, parentId, tree } = ctx.query

  const filter: Record<string, unknown> = {}
  if (search) {
    filter.name = { $regex: escapeRegex(search as string), $options: 'i' }
  }
  if (status && ['active', 'inactive'].includes(status as string)) {
    filter.status = status as string
  }
  if (parentId !== undefined) {
    filter.parentId = parentId === 'null' ? null : parentId
  }

  const depts = await DeptModel.find(filter).sort({ sort: 1, createdAt: -1 })

  if (tree === 'true') {
    const items = depts.map((d) => d.toJSON())
    ctx.body = { success: true, data: buildTree(items) }
    return
  }

  ctx.body = {
    success: true,
    data: {
      items: depts.map((d) => d.toJSON()),
      total: depts.length,
    },
  }
})

// ────────────────────────────────────────────
// GET /api/depts/:id
// ────────────────────────────────────────────
router.get('/:id', requireAuth, requirePermission('dept:view'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const dept = await DeptModel.findById(id)
  if (!dept) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Department not found.' } }
    return
  }

  ctx.body = { success: true, data: dept.toJSON() }
})

// ────────────────────────────────────────────
// POST /api/depts
// Creates a department. Validates parentId exists if provided.
// ────────────────────────────────────────────
router.post('/', requireAuth, requirePermission('dept:create'), validate(createDeptSchema), async (ctx) => {
  const { name, parentId, sort, status, leader } = ctx.request.body as {
    name: string
    parentId: string | null
    sort: number
    status: string
    leader: string
  }

  // Validate parentId exists if not null
  if (parentId) {
    if (!uuidValidate(parentId)) {
      ctx.status = 400
      ctx.body = { success: false, error: { message: 'Invalid parent department UUID.' } }
      return
    }
    const parent = await DeptModel.findById(parentId)
    if (!parent) {
      ctx.status = 400
      ctx.body = { success: false, error: { message: 'Parent department not found.' } }
      return
    }
  }

  // Check duplicate name at same level
  const tenantId = getCurrentTenantId()
  const siblingFilter: Record<string, unknown> = {
    name,
    parentId: parentId ?? null,
  }
  if (tenantId) siblingFilter.tenantId = tenantId
  const existing = await DeptModel.findOne(siblingFilter)
  if (existing) {
    ctx.status = 409
    ctx.body = { success: false, error: { message: '同级下已存在同名部门。' } }
    return
  }

  const dept = await DeptModel.create({
    _id: uuidv4(),
    name,
    parentId: parentId ?? null,
    sort,
    status,
    leader,
  })

  ctx.status = 201
  ctx.body = { success: true, data: dept.toJSON() }
})

// ────────────────────────────────────────────
// PUT /api/depts/:id
// Updates department fields (not parentId — use PATCH /move for that).
// ────────────────────────────────────────────
router.put('/:id', requireAuth, requirePermission('dept:edit'), validate(updateDeptSchema), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await DeptModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Department not found.' } }
    return
  }

  const body = ctx.request.body as Record<string, unknown>

  // If name is changing, check duplicate at same level
  if (body.name && body.name !== existing.name) {
    const tenantId = getCurrentTenantId()
    const siblingFilter: Record<string, unknown> = {
      name: body.name,
      parentId: existing.parentId,
      _id: { $ne: id },
    }
    if (tenantId) siblingFilter.tenantId = tenantId
    const dup = await DeptModel.findOne(siblingFilter)
    if (dup) {
      ctx.status = 409
      ctx.body = { success: false, error: { message: '同级下已存在同名部门。' } }
      return
    }
  }

  const update: Record<string, unknown> = {}
  if (body.name !== undefined) update.name = body.name
  if (body.sort !== undefined) update.sort = body.sort
  if (body.status !== undefined) update.status = body.status
  if (body.leader !== undefined) update.leader = body.leader

  const dept = await DeptModel.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true })

  ctx.body = { success: true, data: dept!.toJSON() }
})

// ────────────────────────────────────────────
// PATCH /api/depts/:id/move
// Moves a department to a new parent (or root if parentId=null).
// Validates: cannot move to self, cannot create cycle.
// ────────────────────────────────────────────
router.patch('/:id/move', requireAuth, requirePermission('dept:edit'), validate(moveDeptSchema), async (ctx) => {
  const { id } = ctx.params
  const { parentId } = ctx.request.body as { parentId: string | null }

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const dept = await DeptModel.findById(id)
  if (!dept) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Department not found.' } }
    return
  }

  // Cannot move to self
  if (parentId === id) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Cannot move department under itself.' } }
    return
  }

  // Validate parentId exists if not null
  if (parentId) {
    if (!uuidValidate(parentId)) {
      ctx.status = 400
      ctx.body = { success: false, error: { message: 'Invalid parent department UUID.' } }
      return
    }
    const parent = await DeptModel.findById(parentId)
    if (!parent) {
      ctx.status = 400
      ctx.body = { success: false, error: { message: 'Target parent department not found.' } }
      return
    }

    // Cycle detection: walk up from parentId to root, ensure `id` is not an ancestor
    let current = parent
    while (current.parentId) {
      if (current.parentId === id) {
        ctx.status = 400
        ctx.body = { success: false, error: { message: 'Cannot move department under its own descendant (cycle detected).' } }
        return
      }
      const ancestor = await DeptModel.findById(current.parentId)
      if (!ancestor) break
      current = ancestor
    }
  }

  // Check duplicate name at new parent level
  const tenantId = getCurrentTenantId()
  const siblingFilter: Record<string, unknown> = {
    name: dept.name,
    parentId: parentId ?? null,
    _id: { $ne: id },
  }
  if (tenantId) siblingFilter.tenantId = tenantId
  const dup = await DeptModel.findOne(siblingFilter)
  if (dup) {
    ctx.status = 409
    ctx.body = { success: false, error: { message: '目标层级下已存在同名部门。' } }
    return
  }

  const updated = await DeptModel.findByIdAndUpdate(
    id,
    { $set: { parentId: parentId ?? null } },
    { new: true },
  )

  ctx.body = { success: true, data: updated!.toJSON() }
})

// ────────────────────────────────────────────
// DELETE /api/depts/:id
// Deletes a department. Rejects if it has children.
// ────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('dept:delete'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await DeptModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Department not found.' } }
    return
  }

  // Check for children
  const childCount = await DeptModel.countDocuments({ parentId: id })
  if (childCount > 0) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Cannot delete department with children. Delete or move children first.' } }
    return
  }

  // Check for associated users
  const userCount = await UserModel.countDocuments({ deptId: id })
  if (userCount > 0) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Cannot delete department with associated users. Reassign users first.' } }
    return
  }

  await DeptModel.findByIdAndDelete(id)

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

export default router
