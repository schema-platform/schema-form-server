import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { FlowDefinitionModel } from '../flow-models/FlowDefinition.js'
import { FlowVersionModel } from '../flow-models/FlowVersion.js'
import { FlowInstanceModel } from '../flow-models/FlowInstance.js'
import { TaskInstanceModel } from '../flow-models/TaskInstance.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createFlowSchema, updateFlowSchema } from '../flow-schemas/flowSchemas.js'
import { flowPermissionService } from '../flow-services/FlowPermissionService.js'

const requireAuth = authMiddleware({ required: true })
const requireFlowDesign = requirePermission('flow:design')
const requireFlowView = requirePermission('flow:view')

const router = new Router({ prefix: '/api/flows' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// GET /api/flows
router.get('/', requireAuth, requireFlowView, async (ctx) => {
  const { search, status, page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query
  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (search) filter.name = { $regex: escapeRegex(search as string), $options: 'i' }
  if (status && ['draft', 'published', 'archived'].includes(status as string)) {
    filter.status = status
  }

  const [items, total] = await Promise.all([
    FlowDefinitionModel.find(filter).skip(skip).limit(pageSize).sort({ updatedAt: -1 }),
    FlowDefinitionModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  }
})

// POST /api/flows
router.post('/', requireAuth, requireFlowDesign, validate(createFlowSchema), async (ctx) => {
  const { name, description, category, permissions } = ctx.request.body as {
    name: string
    description?: string
    category?: string
    permissions?: { editors?: string[]; launchers?: string[]; viewers?: string[] }
  }

  const definition = await FlowDefinitionModel.create({
    _id: uuidv4(),
    name: name.trim(),
    description: description ?? '',
    category: category ?? '',
    status: 'draft',
    createdBy: (ctx.state.user as { id: string }).id,
    permissions: {
      editors: permissions?.editors ?? [],
      launchers: permissions?.launchers ?? [],
      viewers: permissions?.viewers ?? [],
    },
  })

  ctx.status = 201
  ctx.body = { success: true, data: definition }
})

// GET /api/flows/:id
router.get('/:id', requireAuth, requireFlowView, async (ctx) => {
  const { id } = ctx.params
  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const definition = await FlowDefinitionModel.findById(id)
  if (!definition) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Flow definition not found.' } }
    return
  }

  ctx.body = { success: true, data: definition }
})

// PUT /api/flows/:id
router.put('/:id', requireAuth, requireFlowDesign, validate(updateFlowSchema), async (ctx) => {
  const { id } = ctx.params
  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const userId = (ctx.state.user as { id: string }).id
  const canEdit = await flowPermissionService.checkEditPermission(userId, id)
  if (!canEdit) {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'You do not have permission to edit this flow.' } }
    return
  }

  const existing = await FlowDefinitionModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Flow definition not found.' } }
    return
  }

  const data: Record<string, unknown> = {}
  const { name, description, category, thumbnail, permissions } = ctx.request.body as {
    name?: string
    description?: string
    category?: string
    thumbnail?: string
    permissions?: { editors?: string[]; launchers?: string[]; viewers?: string[] }
  }
  if (name !== undefined) data.name = name.trim()
  if (description !== undefined) data.description = description
  if (category !== undefined) data.category = category
  if (thumbnail !== undefined) data.thumbnail = thumbnail
  if (permissions !== undefined) {
    data.permissions = {
      editors: permissions.editors ?? existing.permissions?.editors ?? [],
      launchers: permissions.launchers ?? existing.permissions?.launchers ?? [],
      viewers: permissions.viewers ?? existing.permissions?.viewers ?? [],
    }
  }

  if (Object.keys(data).length === 0) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'No fields to update.' } }
    return
  }

  const definition = await FlowDefinitionModel.findByIdAndUpdate(id, data, { new: true })
  ctx.body = { success: true, data: definition }
})

// DELETE /api/flows/:id
router.delete('/:id', requireAuth, requireFlowDesign, async (ctx) => {
  const { id } = ctx.params
  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const userId = (ctx.state.user as { id: string }).id
  const canEdit = await flowPermissionService.checkEditPermission(userId, id)
  if (!canEdit) {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'You do not have permission to delete this flow.' } }
    return
  }

  const existing = await FlowDefinitionModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Flow definition not found.' } }
    return
  }

  await FlowVersionModel.deleteMany({ definitionId: id })
  const instances = await FlowInstanceModel.find({ definitionId: id }, { _id: 1 })
  const instanceIds = instances.map((inst) => inst._id)
  await FlowInstanceModel.deleteMany({ definitionId: id })
  if (instanceIds.length > 0) {
    await TaskInstanceModel.deleteMany({ instanceId: { $in: instanceIds } })
  }
  await FlowDefinitionModel.findByIdAndDelete(id)

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

// POST /api/flows/:id/publish
router.post('/:id/publish', requireAuth, requireFlowDesign, async (ctx) => {
  const { id } = ctx.params
  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const userId = (ctx.state.user as { id: string }).id
  const canEdit = await flowPermissionService.checkEditPermission(userId, id)
  if (!canEdit) {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'You do not have permission to publish this flow.' } }
    return
  }

  const definition = await FlowDefinitionModel.findById(id)
  if (!definition) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Flow definition not found.' } }
    return
  }

  const latestVersion = await FlowVersionModel.findOne({ definitionId: id }).sort({ version: -1 })
  if (!latestVersion) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'No versions to publish. Save a version first.' } }
    return
  }

  definition.status = 'published'
  definition.currentVersionId = latestVersion._id
  await definition.save()

  ctx.body = { success: true, data: definition }
})

export default router
