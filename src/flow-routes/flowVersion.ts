import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { FlowVersionModel } from '../flow-models/FlowVersion.js'
import { FlowDefinitionModel } from '../flow-models/FlowDefinition.js'
import { authMiddleware } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { saveVersionSchema } from '../flow-schemas/flowSchemas.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/flows/:definitionId/versions' })

// GET /api/flows/:definitionId/versions
router.get('/', async (ctx) => {
  const { definitionId } = ctx.params
  const { page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query
  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  if (!uuidValidate(definitionId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const [items, total] = await Promise.all([
    FlowVersionModel.find({ definitionId })
      .sort({ version: -1 })
      .skip(skip)
      .limit(pageSize)
      .select('-graph'),
    FlowVersionModel.countDocuments({ definitionId }),
  ])

  ctx.body = {
    success: true,
    data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  }
})

// POST /api/flows/:definitionId/versions
router.post('/', requireAuth, validate(saveVersionSchema), async (ctx) => {
  const { definitionId } = ctx.params
  const { graph, metadata } = ctx.request.body as {
    graph: { nodes: unknown[]; edges: unknown[] }
    metadata?: { viewport?: { x: number; y: number; zoom: number } }
  }

  if (!uuidValidate(definitionId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const definition = await FlowDefinitionModel.findById(definitionId)
  if (!definition) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Flow definition not found.' } }
    return
  }

  const now = new Date()
  const pad = (n: number, len: number) => String(n).padStart(len, '0')
  const nextVersion = `v${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`

  const version = await FlowVersionModel.create({
    _id: uuidv4(),
    definitionId,
    version: nextVersion,
    graph,
    metadata: metadata ?? null,
  })

  definition.currentVersionId = version._id
  await definition.save()

  ctx.status = 201
  ctx.body = { success: true, data: version }
})

// GET /api/flows/:definitionId/versions/latest
router.get('/latest', async (ctx) => {
  const { definitionId } = ctx.params

  if (!uuidValidate(definitionId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const version = await FlowVersionModel.findOne({ definitionId }).sort({ version: -1 })
  if (!version) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'No versions found.' } }
    return
  }

  ctx.body = { success: true, data: version }
})

// GET /api/flows/:definitionId/versions/:versionId
router.get('/:versionId', async (ctx) => {
  const { versionId } = ctx.params

  if (!uuidValidate(versionId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const version = await FlowVersionModel.findById(versionId)
  if (!version) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Version not found.' } }
    return
  }

  ctx.body = { success: true, data: version }
})

export default router
