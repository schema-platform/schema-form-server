import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { FormSchemaModel } from '../models/FormSchema.js'
import { PublishedSchemaModel } from '../models/PublishedSchema.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permission.js'
import { validate } from '../middleware/validate.js'
import { createSchemaSchema, updateSchemaSchema, importSchemaSchema } from '../schemas/schemaSchemas.js'
import { eventBus } from '../services/eventBus.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/schemas' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Generate a version timestamp string in yyyymmddhhmmss format.
 */
function generateVersion(): string {
  const now = new Date()
  const pad = (n: number, len: number) => String(n).padStart(len, '0')
  return (
    pad(now.getFullYear(), 4) +
    pad(now.getMonth() + 1, 2) +
    pad(now.getDate(), 2) +
    pad(now.getHours(), 2) +
    pad(now.getMinutes(), 2) +
    pad(now.getSeconds(), 2)
  )
}

/**
 * Valid widget types for import validation.
 */
const VALID_WIDGET_TYPES = new Set([
  'form', 'card', 'row-col', 'tabs', 'dialog',
  'input', 'number', 'select', 'radio', 'checkbox',
  'date', 'date-range', 'textarea', 'richtext',
  'button', 'button-list', 'upload', 'table',
  'search-list', 'editable-table', 'title', 'divider',
  'spacer', 'toolbar-buttons', 'file-list', 'transfer',
  'banner', 'tree-layout', 'date-time-slot',
  'grid-row', 'grid-col', 'page', 'toolbar', 'pagination', 'steps',
])

interface WidgetNode {
  type?: string
  id?: string
  children?: WidgetNode[]
  [key: string]: unknown
}

interface ValidationError {
  path: string
  message: string
}

/**
 * Walk the json tree and validate that every widget has a valid type.
 * Also collect validation errors.
 */
function validateWidgetTree(nodes: WidgetNode[], errors: ValidationError[], prefix = ''): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const path = prefix ? `${prefix}[${i}]` : `[${i}]`

    if (!node.type) {
      errors.push({ path: `${path}.type`, message: 'Widget is missing required "type" field.' })
    } else if (!VALID_WIDGET_TYPES.has(node.type)) {
      errors.push({ path: `${path}.type`, message: `Invalid widget type "${node.type}".` })
    }

    if (node.children && Array.isArray(node.children)) {
      validateWidgetTree(node.children, errors, path)
    }
  }
}

/**
 * Walk the json tree and regenerate all `id` fields with new UUIDs.
 */
function regenerateIds(nodes: WidgetNode[]): void {
  for (const node of nodes) {
    node.id = uuidv4()
    if (node.children && Array.isArray(node.children)) {
      regenerateIds(node.children)
    }
  }
}

/**
 * Check if a string is a valid UUID.
 */
function isUUID(str: string): boolean {
  return uuidValidate(str)
}

// ────────────────────────────────────────────
// GET /api/schemas
// Lists draft schemas with optional filters.
// ────────────────────────────────────────────
router.get('/', requireAuth, async (ctx) => {
  const { search, type, page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query
  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}
  if (search) filter.name = { $regex: escapeRegex(search as string), $options: 'i' }
  if (type && ['form', 'search_list'].includes(type as string)) filter.type = type as string

  const [items, total] = await Promise.all([
    FormSchemaModel.find(filter).skip(skip).limit(pageSize).sort({ updatedAt: -1 }),
    FormSchemaModel.countDocuments(filter),
  ])

  // Attach publishId for schemas that have a published version
  const editIds = items.map(item => item.editId)
  const published = await PublishedSchemaModel.find({ sourceId: { $in: editIds } })
  const publishedMap = new Map(published.map(p => [p.sourceId, p.publishId]))

  const enrichedItems = items.map(item => {
    const obj = item.toJSON()
    const publishId = publishedMap.get(item.editId)
    if (publishId) obj.publishId = publishId
    return obj
  })

  ctx.body = {
    success: true,
    data: {
      items: enrichedItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// ────────────────────────────────────────────
// POST /api/schemas
// Create a new schema document (first save). editId is auto-generated.
// ────────────────────────────────────────────
router.post('/', requireAuth, requirePermission('schema:create'), validate(createSchemaSchema), async (ctx) => {
  const { name, json, type, thumbnail } = ctx.request.body as {
    name?: string; json?: unknown; type?: string; thumbnail?: string
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Field "name" is required and must be a non-empty string.' } }
    return
  }

  if (json === undefined || json === null) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Field "json" is required.' } }
    return
  }

  const schemaType = (type === 'search-list' || type === 'search_list') ? 'search_list' : 'form'
  const version = generateVersion()

  const userId = (ctx.state.user as { id: string }).id

  const schema = await FormSchemaModel.create({
    _id: uuidv4(),
    editId: uuidv4(),
    version,
    name: name.trim(),
    type: schemaType,
    json: json as object,
    versions: [],
    createdBy: userId,
    ...(thumbnail ? { thumbnail } : {}),
  })

  ctx.status = 201
  ctx.body = { success: true, data: schema }
})

// ────────────────────────────────────────────
// POST /api/schemas/import
// Import a schema with deep validation.
// ────────────────────────────────────────────
router.post('/import', requireAuth, requirePermission('schema:create'), validate(importSchemaSchema), async (ctx) => {
  const { name, type, json, thumbnail } = ctx.request.body as {
    name?: string; type?: string; json?: unknown; thumbnail?: string
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Field "name" is required and must be a non-empty string.' } }
    return
  }

  if (!json || !Array.isArray(json)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Field "json" is required and must be an array.' } }
    return
  }

  // Validate widget tree
  const validationErrors: ValidationError[] = []
  validateWidgetTree(json as WidgetNode[], validationErrors)

  if (validationErrors.length > 0) {
    ctx.status = 400
    ctx.body = {
      success: false,
      error: {
        message: 'Import validation failed.',
        details: validationErrors,
      },
    }
    return
  }

  // Regenerate all IDs
  regenerateIds(json as WidgetNode[])

  const schemaType = (type === 'search-list' || type === 'search_list') ? 'search_list' : 'form'
  const editId = uuidv4()
  const version = generateVersion()

  const userId = (ctx.state.user as { id: string }).id

  const schema = await FormSchemaModel.create({
    _id: uuidv4(),
    editId,
    version,
    name: name.trim(),
    type: schemaType,
    json: json as object,
    createdBy: userId,
    ...(thumbnail ? { thumbnail } : {}),
  })

  ctx.status = 201
  ctx.body = { success: true, data: schema }
})

// ────────────────────────────────────────────
// GET /api/schemas/published
// Lists all published schemas (no auth required).
// ────────────────────────────────────────────
router.get('/published', requireAuth, async (ctx) => {
  const items = await PublishedSchemaModel.find({}, { json: 0 }).sort({ updatedAt: -1 })

  ctx.body = {
    success: true,
    data: items.map((item) => ({
      id: item._id,
      name: item.name,
      type: item.type,
      publishId: item.publishId,
      version: item.version,
      updatedAt: item.updatedAt,
    })),
  }
})

// ────────────────────────────────────────────
// GET /api/schemas/published/:sourceId
// Reads published schema by source FormSchema ID.
// ────────────────────────────────────────────
router.get('/published/:sourceId', requireAuth, async (ctx) => {
  const { sourceId } = ctx.params

  if (!uuidValidate(sourceId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const published = await PublishedSchemaModel.findOne({ sourceId })

  if (!published) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Published schema not found.' } }
    return
  }

  ctx.body = { success: true, data: published }
})

// ────────────────────────────────────────────
// GET /api/schemas/published/by-publish-id/:publishId
// Reads published schema by publishId.
// ────────────────────────────────────────────
router.get('/published/by-publish-id/:publishId', requireAuth, async (ctx) => {
  const { publishId } = ctx.params

  const published = await PublishedSchemaModel.findOne({ publishId })

  if (!published) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Published schema not found.' } }
    return
  }

  ctx.body = { success: true, data: published }
})

// ────────────────────────────────────────────
// GET /api/schemas/:editId/versions
// Query FormSchema by editId, sort by version desc.
// Must be registered before GET /:id to avoid param collision.
// ────────────────────────────────────────────
router.get('/:param/versions', requireAuth, async (ctx) => {
  const { param } = ctx.params
  const { page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query
  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const editId = param

  // 单文档模型：一个 editId 对应一个文档，versions 嵌入在文档内
  const schema = await FormSchemaModel.findOne({ editId })

  if (!schema) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'No versions found for this editId.' } }
    return
  }

  // 获取发布版本号
  const published = await PublishedSchemaModel.findOne({ sourceId: schema.editId })

  // 版本列表 = 历史快照 + 当前版本（最新）
  const allVersions = [
    { id: schema._id, version: schema.version, createdAt: schema.updatedAt || schema.createdAt, published: published ? published.version === schema.version : false },
    ...(schema.versions || []).map((v: { version: string; createdAt: Date }) => ({
      id: schema._id,
      version: v.version,
      createdAt: v.createdAt,
      published: published ? published.version === v.version : false,
    })),
  ]

  // 按版本号降序排列
  allVersions.sort((a, b) => b.version.localeCompare(a.version))

  // 分页切片
  const pageSize = Math.max(1, parseInt(pageSizeStr as string, 10) || 20)
  const start = (page - 1) * pageSize
  const items = allVersions.slice(start, start + pageSize)

  ctx.body = {
    success: true,
    data: {
      items,
      total: allVersions.length,
      page,
      pageSize,
    },
  }
})

// ────────────────────────────────────────────
// GET /api/schemas/:editId/versions/:version
// Query by editId, find version in embedded versions array or current.
// ────────────────────────────────────────────
router.get('/:param/versions/:version', requireAuth, async (ctx) => {
  const { param, version } = ctx.params

  const schema = await FormSchemaModel.findOne({ editId: param })

  if (!schema) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Schema not found.' } }
    return
  }

  // 当前版本匹配
  if (schema.version === version) {
    ctx.body = { success: true, data: schema }
    return
  }

  // 从历史快照中查找
  const snapshot = (schema.versions || []).find((v: { version: string }) => v.version === version)

  if (!snapshot) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Schema version not found.' } }
    return
  }

  ctx.body = {
    success: true,
    data: {
      id: schema._id,
      editId: schema.editId,
      version: snapshot.version,
      name: schema.name,
      type: schema.type,
      status: schema.status,
      json: snapshot.json,
      thumbnail: schema.thumbnail,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.createdAt,
    },
  }
})

// ────────────────────────────────────────────
// DELETE /api/schemas/:editId/versions/:version
// Remove a specific version snapshot from the embedded versions array.
// Cannot delete the current (active) version.
// ────────────────────────────────────────────
router.delete('/:param/versions/:version', requireAuth, requirePermission('schema:delete'), async (ctx) => {
  const { param, version } = ctx.params

  const schema = await FormSchemaModel.findOne({ editId: param })

  if (!schema) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Schema not found.' } }
    return
  }

  // 禁止删除当前版本
  if (schema.version === version) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Cannot delete the current version.' } }
    return
  }

  const versions: { version: string; createdAt: Date; json: unknown }[] = schema.versions || []
  const idx = versions.findIndex((v) => v.version === version)

  if (idx === -1) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Version not found.' } }
    return
  }

  await FormSchemaModel.updateOne(
    { editId: param },
    { $pull: { versions: { version } } },
  )

  ctx.body = { success: true }
})

// ────────────────────────────────────────────
// GET /api/schemas/:id
// ────────────────────────────────────────────
router.get('/:id', requireAuth, async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const schema = await FormSchemaModel.findById(id)

  if (!schema) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Schema not found.' } }
    return
  }

  ctx.body = { success: true, data: schema }
})

// PUT /api/schemas/:id
// Update schema: push current state as version snapshot, then apply changes.
// Keeps at most MAX_VERSIONS snapshots; oldest are pruned.
// ────────────────────────────────────────────
const MAX_VERSIONS = 15

router.put('/:id', requireAuth, requirePermission('schema:edit'), validate(updateSchemaSchema), async (ctx) => {
  const { id } = ctx.params
  const { name, json, status, type, thumbnail } = ctx.request.body as {
    name?: string; json?: unknown; status?: string; type?: string; thumbnail?: string
  }

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await FormSchemaModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Schema not found.' } }
    return
  }

  const data: Record<string, unknown> = {}
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      ctx.status = 400
      ctx.body = { success: false, error: { message: 'Field "name" must be a non-empty string.' } }
      return
    }
    data.name = name.trim()
  }
  if (json !== undefined) {
    if (json === null) {
      ctx.status = 400
      ctx.body = { success: false, error: { message: 'Field "json" cannot be null.' } }
      return
    }
    data.json = json
  }
  if (status !== undefined) {
    if (status !== 'draft') {
      ctx.status = 400
      ctx.body = { success: false, error: { message: 'Cannot change status to "published". Use POST /:id/publish to publish a schema.' } }
      return
    }
    data.status = status
  }
  if (type !== undefined) {
    if (!['form', 'search_list', 'layout', 'table', 'chart', 'business', 'report', 'other'].includes(type as string)) {
      ctx.status = 400
      ctx.body = { success: false, error: { message: 'Field "type" must be one of: form, search_list, layout, table, chart, business, report, other.' } }
      return
    }
    data.type = type
  }
  if (thumbnail !== undefined) {
    data.thumbnail = thumbnail
  }

  if (Object.keys(data).length === 0) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'No fields to update. Provide name, json, and/or type.' } }
    return
  }

  // 生成新版本号，更新主字段
  const newVersion = generateVersion()
  data.version = newVersion

  const schema = await FormSchemaModel.findByIdAndUpdate(id, data, { new: true })

  // 推入当前版本快照到 versions 数组，保持最多 MAX_VERSIONS 个
  await FormSchemaModel.findByIdAndUpdate(id, {
    $push: {
      versions: {
        $each: [{
          version: existing.version,
          json: existing.json,
          createdAt: existing.updatedAt || existing.createdAt,
        }],
        $slice: -MAX_VERSIONS,
      },
    },
  })

  ctx.body = { success: true, data: schema }
})

// ────────────────────────────────────────────
// POST /api/schemas/:id/publish
// Publishes a schema. Accepts optional `version` in body.
// If provided, find the schema by editId+version and publish that.
// Otherwise publish the `:id` document.
// ────────────────────────────────────────────
router.post('/:id/publish', requireAuth, requirePermission('schema:publish'), async (ctx) => {
  const { id } = ctx.params
  const { version: bodyVersion } = ctx.request.body as { version?: string }

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  let draft = await FormSchemaModel.findById(id)
  if (!draft) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Schema not found.' } }
    return
  }

  // If a specific version is requested, find that version in snapshots or current
  let publishJson = draft.json
  let publishVersion = draft.version
  if (bodyVersion && bodyVersion !== draft.version) {
    const snapshot = (draft.versions || []).find((v: { version: string }) => v.version === bodyVersion)
    if (!snapshot) {
      ctx.status = 404
      ctx.body = { success: false, error: { message: `Schema version "${bodyVersion}" not found.` } }
      return
    }
    publishJson = snapshot.json
    publishVersion = snapshot.version
  }

  const now = new Date()
  const newPublishId = uuidv4()

  const published = await PublishedSchemaModel.findOneAndUpdate(
    { sourceId: draft.editId },
    {
      $set: {
        name: draft.name,
        type: draft.type,
        json: publishJson,
        thumbnail: draft.thumbnail,
        publishId: newPublishId,
        version: publishVersion,
        publishedAt: now,
      },
      $setOnInsert: {
        _id: uuidv4(),
        sourceId: draft.editId,
        tenantId: draft.tenantId,
      },
    },
    { upsert: true, new: true, runValidators: true },
  )

  ctx.body = { success: true, data: published }

  // Fire-and-forget webhook event
  eventBus.emit('schema.published', { schemaId: draft.editId, name: draft.name }).catch((err) => console.error('[schema.published] emit failed:', err))
})

// ────────────────────────────────────────────
// DELETE /api/schemas/:id
// ────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('schema:delete'), async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await FormSchemaModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Schema not found.' } }
    return
  }

  // Also remove any published version for this schema's editId
  await PublishedSchemaModel.deleteOne({ sourceId: existing.editId })
  await FormSchemaModel.findByIdAndDelete(id)

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

export default router
