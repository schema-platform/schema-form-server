import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { FormSchemaModel } from '../models/FormSchema.js'
import { PublishedSchemaModel } from '../models/PublishedSchema.js'

const router = new Router({ prefix: '/api/mock' })

interface WidgetNode {
  type?: string
  field?: string
  options?: Array<{ label?: string; value?: unknown }>
  children?: WidgetNode[]
  [key: string]: unknown
}

function generateMockValue(widget: WidgetNode): unknown {
  const type = widget.type ?? ''
  switch (type) {
    case 'input':
    case 'textarea':
    case 'richtext':
    case 'title':
      return '示例文本'
    case 'number':
      return Math.floor(Math.random() * 100) + 1
    case 'select':
    case 'radio':
      if (widget.options && widget.options.length > 0) {
        return widget.options[0].value
      }
      return 'option1'
    case 'checkbox':
      if (widget.options && widget.options.length > 0) {
        return [widget.options[0].value]
      }
      return ['option1']
    case 'date':
    case 'date-range':
    case 'date-time-slot':
      return new Date().toISOString()
    case 'upload':
    case 'file-list':
      return []
    case 'boolean':
    case 'toggle':
      return true
    default:
      return null
  }
}

function walkWidgetTree(nodes: WidgetNode[], result: Record<string, unknown>): void {
  for (const node of nodes) {
    if (node.field) {
      result[node.field] = generateMockValue(node)
    }
    if (node.children && Array.isArray(node.children)) {
      walkWidgetTree(node.children, result)
    }
  }
}

/**
 * GET /api/mock/:schemaId
 */
router.get('/:schemaId', async (ctx) => {
  const { schemaId } = ctx.params

  if (!uuidValidate(schemaId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  // Try FormSchema first, then PublishedSchema
  let schema = await FormSchemaModel.findById(schemaId)
  if (!schema) {
    schema = await PublishedSchemaModel.findById(schemaId)
  }

  if (!schema) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Schema not found.' } }
    return
  }

  const json = schema.json as { children?: WidgetNode[] } | WidgetNode[]
  const nodes: WidgetNode[] = Array.isArray(json) ? json : (json.children ?? [])
  const mockData: Record<string, unknown> = {}
  walkWidgetTree(nodes, mockData)

  ctx.body = { success: true, data: mockData }
})

export default router
