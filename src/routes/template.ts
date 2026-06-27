import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { WidgetTemplateModel } from '../models/WidgetTemplate.js'
import { authMiddleware } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createTemplateSchema, updateTemplateSchema } from '../schemas/templateSchemas.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/templates' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface WidgetNode {
  id?: string
  type?: string
  children?: WidgetNode[]
  [key: string]: unknown
}

/** 生成 Widget ID：{type}_{5位随机hash} */
function generateWidgetId(type: string): string {
  const hash = Math.random().toString(36).substring(2, 7)
  return `${type}_${hash}`
}

function regenerateIds(nodes: WidgetNode[]): void {
  for (const node of nodes) {
    // 保留类型前缀，从旧 ID 或 type 字段提取
    const type = node.type || (node.id ? node.id.split('_')[0] : 'widget')
    node.id = generateWidgetId(type)
    if (node.children && Array.isArray(node.children)) {
      regenerateIds(node.children)
    }
  }
}

// Valid categories for filtering
const VALID_CATEGORIES = ['form', 'layout', 'table', 'search', 'chart', 'business', 'report', 'other']

// ────────────────────────────────────────────
// GET /api/templates
// Lists templates with optional search/category/tag/widgetType filters and pagination.
// ────────────────────────────────────────────
router.get('/', async (ctx) => {
  const {
    search,
    category,
    tag,
    widgetType,
    isBuiltin,
    page: pageStr = '1',
    pageSize: pageSizeStr = '20',
  } = ctx.query

  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}

  if (search) {
    filter.$or = [
      { name: { $regex: escapeRegex(search as string), $options: 'i' } },
      { description: { $regex: escapeRegex(search as string), $options: 'i' } },
    ]
  }

  if (category && VALID_CATEGORIES.includes(category as string)) {
    filter.category = category
  }

  if (tag) {
    filter.tags = { $in: Array.isArray(tag) ? tag : [tag] }
  }

  if (widgetType) {
    filter.widgetType = widgetType as string
  }

  if (isBuiltin !== undefined) {
    filter.isBuiltin = isBuiltin === 'true' || isBuiltin === '1'
  }

  const [items, total] = await Promise.all([
    WidgetTemplateModel.find(filter).skip(skip).limit(pageSize).sort({ updatedAt: -1 }),
    WidgetTemplateModel.countDocuments(filter),
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
// POST /api/templates
// Create a new template.
// ────────────────────────────────────────────
router.post('/', requireAuth, validate(createTemplateSchema), async (ctx) => {
  const { name, description, category, widgetType, thumbnail, widgets, tags, isBuiltin } = ctx.request.body as {
    name: string
    description: string
    category: string
    widgetType: string
    thumbnail: string
    widgets: Record<string, unknown>[]
    tags: string[]
    isBuiltin: boolean
  }

  const user = ctx.state.user as { id?: string } | undefined

  const template = await WidgetTemplateModel.create({
    _id: uuidv4(),
    name: name.trim(),
    description,
    category,
    widgetType,
    thumbnail,
    widgets,
    tags,
    isBuiltin,
    createdBy: user?.id ?? '',
  })

  ctx.status = 201
  ctx.body = { success: true, data: template }
})

// ────────────────────────────────────────────
// GET /api/templates/:id
// Get a single template by ID.
// ────────────────────────────────────────────
router.get('/:id', async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const template = await WidgetTemplateModel.findById(id)

  if (!template) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Template not found.' } }
    return
  }

  ctx.body = { success: true, data: template }
})

// ────────────────────────────────────────────
// PUT /api/templates/:id
// Update a template.
// ────────────────────────────────────────────
router.put('/:id', requireAuth, validate(updateTemplateSchema), async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as Record<string, unknown>

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await WidgetTemplateModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Template not found.' } }
    return
  }

  if (body.name !== undefined && typeof body.name === 'string') {
    body.name = body.name.trim()
  }

  const template = await WidgetTemplateModel.findByIdAndUpdate(id, body, { new: true })

  ctx.body = { success: true, data: template }
})

// ────────────────────────────────────────────
// DELETE /api/templates/:id
// Delete a template.
// ────────────────────────────────────────────
router.delete('/:id', requireAuth, async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await WidgetTemplateModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Template not found.' } }
    return
  }

  await WidgetTemplateModel.findByIdAndDelete(id)

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

// ────────────────────────────────────────────
// POST /api/templates/:id/apply
// Apply a template: returns widgets JSON with regenerated IDs.
// ────────────────────────────────────────────
router.post('/:id/apply', async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const template = await WidgetTemplateModel.findById(id)

  if (!template) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Template not found.' } }
    return
  }

  const widgets = JSON.parse(JSON.stringify(template.widgets)) as WidgetNode[]
  regenerateIds(widgets)

  // Increment usage count asynchronously (fire-and-forget)
  WidgetTemplateModel.findByIdAndUpdate(id, { $inc: { usageCount: 1 } }).catch((err) => {
    console.error('[template] Failed to increment usageCount:', err)
  })

  ctx.body = {
    success: true,
    data: {
      name: template.name,
      widgets,
    },
  }
})

export default router
