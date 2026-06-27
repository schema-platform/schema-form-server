/**
 * Editor Agent tools — LangGraph StructuredTool format.
 *
 * 使用共享 toolHandlers 层，与 MCP 工具共用同一份业务逻辑。
 */

import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { FormSchemaModel } from '../../models/FormSchema.js'
import { adaptWidgets, type PartialWidget } from '../services/schemaAdapter.js'
import {
  getMetadata,
  handleSchemaGetDetail,
  handleSchemaSearchPublished,
  handleSchemaValidate,
  handleSchemaFuzzySearch,
  handleSchemaFindFlowReferences,
  handleWidgetQuery,
} from './toolHandlers.js'
import { z } from 'zod'
import type { ToolResult } from './types.js'

// ────────────────────────────────────────────
// LangGraph tools（复用 toolHandlers）
// ────────────────────────────────────────────

export const getSchemaDetailTool = tool(
  async ({ schemaId }): Promise<string> => {
    const result = await handleSchemaGetDetail(schemaId)
    return JSON.stringify(result)
  },
  {
    name: 'get_schema_detail',
    description: `获取指定 Schema 的完整 JSON 内容。参数：schemaId — Schema 的 _id。`,
    schema: z.object({ schemaId: z.string().describe('Schema 的 _id') }),
  },
)

export const searchPublishedSchemasTool = tool(
  async ({ keyword, limit }): Promise<string> => {
    const result = await handleSchemaSearchPublished({ keyword, limit })
    return JSON.stringify(result)
  },
  {
    name: 'search_published_schemas',
    description: `搜索已发布的 Schema 版本。参数：keyword — 按名称模糊搜索；limit — 返回数量上限。`,
    schema: z.object({
      keyword: z.string().optional().describe('按名称模糊搜索'),
      limit: z.number().optional().default(10).describe('返回数量上限'),
    }),
  },
)

export const getWidgetCatalogueTool = tool(
  async ({ category }): Promise<string> => {
    const result = handleWidgetQuery(category)
    return JSON.stringify(result)
  },
  {
    name: 'get_widget_catalogue',
    description: `获取 Widget 组件目录。参数：category — 组件分类，不传返回全部。`,
    schema: z.object({
      category: z.enum(['container', 'layout', 'form', 'static', 'action', 'table', 'business', 'chart'])
        .optional().describe('按组件分类筛选'),
    }),
  },
)

export const searchWidgetsByKeywordTool = tool(
  async ({ query, limit }): Promise<string> => {
    const result = await handleSchemaFuzzySearch(query, limit)
    return JSON.stringify(result)
  },
  {
    name: 'fuzzy_search_schemas',
    description: `基于关键词模糊搜索已有 Schema（Jaccard 相似度）。参数：query — 关键词描述；limit — 返回数量上限。`,
    schema: z.object({
      query: z.string().describe('关键词描述'),
      limit: z.number().optional().default(5).describe('返回数量上限'),
    }),
  },
)

export const validateSchemaTool = tool(
  async ({ widgetsJson }): Promise<string> => {
    let widgets: Record<string, unknown>[]
    try {
      const parsed = JSON.parse(widgetsJson)
      if (!Array.isArray(parsed)) {
        return JSON.stringify({ success: false, error: 'widgetsJson 解析结果不是数组' } satisfies ToolResult)
      }
      widgets = parsed as Record<string, unknown>[]
    } catch {
      return JSON.stringify({ success: false, error: 'widgetsJson JSON 解析失败' } satisfies ToolResult)
    }
    const result = await handleSchemaValidate(widgets)
    return JSON.stringify(result)
  },
  {
    name: 'validate_schema',
    description: `校验 Widget Schema JSON 的结构正确性。参数：widgetsJson — Widget 数组的 JSON 字符串。`,
    schema: z.object({ widgetsJson: z.string().describe('Widget 数组的 JSON 字符串') }),
  },
)

export const findFlowReferencesTool = tool(
  async ({ schemaId }): Promise<string> => {
    const result = await handleSchemaFindFlowReferences(schemaId)
    return JSON.stringify(result)
  },
  {
    name: 'find_flow_references',
    description: `查找引用了指定 Schema 的所有流程节点。参数：schemaId — Schema 的 _id。`,
    schema: z.object({ schemaId: z.string().describe('Schema 的 _id') }),
  },
)

// ────────────────────────────────────────────
// Schema Diff（保留，update_schema 需要）
// ────────────────────────────────────────────

interface SchemaDiffEntry {
  type: 'add' | 'remove' | 'modify'
  widgetId: string
  widgetType: string
  path: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  summary: string
}

interface SchemaDiff {
  changes: SchemaDiffEntry[]
  added: number
  removed: number
  modified: number
}

function indexWidgets(
  widgets: Record<string, unknown>[],
  parentPath = '',
): Map<string, { widget: Record<string, unknown>; path: string }> {
  const map = new Map<string, { widget: Record<string, unknown>; path: string }>()
  for (let i = 0; i < widgets.length; i++) {
    const w = widgets[i]
    const id = w.id as string
    const path = parentPath ? `${parentPath}[${i}]` : `[${i}]`
    if (id) map.set(id, { widget: w, path })
    if (Array.isArray(w.children)) {
      for (const [childId, entry] of indexWidgets(w.children as Record<string, unknown>[], path)) {
        map.set(childId, entry)
      }
    }
  }
  return map
}

export function computeSchemaDiff(
  oldWidgets: Record<string, unknown>[],
  newWidgets: Record<string, unknown>[],
): SchemaDiff {
  const oldMap = indexWidgets(oldWidgets)
  const newMap = indexWidgets(newWidgets)
  const changes: SchemaDiffEntry[] = []
  let added = 0, removed = 0, modified = 0

  for (const [id, { widget, path }] of oldMap) {
    if (!newMap.has(id)) {
      removed++
      changes.push({ type: 'remove', widgetId: id, widgetType: (widget.type as string) ?? 'unknown', path, before: widget, summary: `删除了 ${widget.type ?? '未知'} 组件（${widget.label ?? id}）` })
    }
  }

  for (const [id, { widget, path }] of newMap) {
    const oldEntry = oldMap.get(id)
    if (!oldEntry) {
      added++
      changes.push({ type: 'add', widgetId: id, widgetType: (widget.type as string) ?? 'unknown', path, after: widget, summary: `新增了 ${widget.type ?? '未知'} 组件（${widget.label ?? id}）` })
    } else {
      const SKIP_KEYS = new Set(['children', 'position', 'events', 'linkages', 'variables', 'lifecycle'])
      const allKeys = new Set([...Object.keys(oldEntry.widget), ...Object.keys(widget)])
      const changedProps = [...allKeys].filter(k => !SKIP_KEYS.has(k) && JSON.stringify(oldEntry.widget[k]) !== JSON.stringify(widget[k]))
      if (changedProps.length > 0) {
        modified++
        changes.push({ type: 'modify', widgetId: id, widgetType: (widget.type as string) ?? 'unknown', path, before: oldEntry.widget, after: widget, summary: `修改了 ${widget.type ?? '未知'} 组件的 ${changedProps.join('、')} 属性` })
      }
    }
  }

  return { changes, added, removed, modified }
}

// ────────────────────────────────────────────
// Update Schema Tool（保留 HITL + diff 逻辑）
// ────────────────────────────────────────────

export const updateSchemaTool = tool(
  async ({ widgetsJson, schemaId, description }): Promise<string> => {
    let widgets: Record<string, unknown>[]
    try {
      const parsed = JSON.parse(widgetsJson)
      if (!Array.isArray(parsed)) {
        return JSON.stringify({ success: false, error: 'widgetsJson 解析结果不是数组' } satisfies ToolResult)
      }
      widgets = parsed as Record<string, unknown>[]
    } catch {
      return JSON.stringify({ success: false, error: 'widgetsJson JSON 解析失败' } satisfies ToolResult)
    }

    widgets = adaptWidgets(widgets as unknown as PartialWidget[]) as unknown as Record<string, unknown>[]

    // Validate
    const meta = getMetadata()
    const VALID_TYPES = new Set(meta.widgets.map((w) => w.type))
    const CONTAINER_TYPES = new Set(meta.widgets.filter((w) => w.canHaveChildren).map((w) => w.type))

    interface ValidationError { path: string; message: string }
    const errors: ValidationError[] = []

    function walk(nodes: Record<string, unknown>[], prefix: string, depth: number): void {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const path = prefix ? `${prefix}[${i}]` : `[${i}]`
        const type = node.type as string | undefined
        if (!type) { errors.push({ path: `${path}.type`, message: '缺少 type 字段' }); continue }
        if (!VALID_TYPES.has(type)) { errors.push({ path: `${path}.type`, message: `无效的组件类型 "${type}"` }); continue }
        if (!node.id) errors.push({ path: `${path}.id`, message: '缺少 id 字段' })
        const isContainer = CONTAINER_TYPES.has(type)
        const children = node.children as Record<string, unknown>[] | undefined
        if (isContainer) {
          if (!Array.isArray(children)) errors.push({ path: `${path}.children`, message: `容器组件 "${type}" 必须有 children 数组` })
          else walk(children, path, depth + 1)
        } else if (depth === 0 && !isContainer) {
          errors.push({ path, message: `基础组件 "${type}" 必须嵌套在布局容器内` })
        }
      }
    }
    walk(widgets, '', 0)
    if (errors.length > 0) {
      return JSON.stringify({ success: false, error: `Schema 校验失败，${errors.length} 个错误：${errors.slice(0, 3).map(e => e.message).join('；')}` } satisfies ToolResult)
    }

    // Diff
    let diff: SchemaDiff | null = null
    if (schemaId) {
      const existing = await FormSchemaModel.findById(schemaId).select('json').lean() as Record<string, unknown> | null
      if (existing && Array.isArray(existing.json)) diff = computeSchemaDiff(existing.json as Record<string, unknown>[], widgets)
    }

    const diffSummary = diff ? `变更：新增 ${diff.added} 个组件，删除 ${diff.removed} 个，修改 ${diff.modified} 个` : `Schema 包含 ${widgets.length} 个组件`

    const confirmed = interrupt({
      type: 'schema_update',
      message: `确认更新 Schema？${diffSummary}`,
      data: { schemaId, description, diff: diff ? { added: diff.added, removed: diff.removed, modified: diff.modified, changes: diff.changes.slice(0, 10) } : null, widgetCount: widgets.length },
    })
    if (!confirmed) return JSON.stringify({ success: false, error: '用户取消操作' } satisfies ToolResult)

    if (schemaId) {
      const { v4: uuidv4 } = await import('uuid')
      const now = new Date()
      const version = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'), String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'), String(now.getSeconds()).padStart(2, '0')].join('')
      await FormSchemaModel.findByIdAndUpdate(schemaId, { json: widgets, version, updatedAt: now })
      const schema = await FormSchemaModel.findById(schemaId).select('editId name type').lean() as Record<string, unknown> | null
      if (schema) {
        const { PublishedSchemaModel } = await import('../../models/PublishedSchema.js')
        const publishId = uuidv4()
        await PublishedSchemaModel.create({ _id: uuidv4(), sourceId: schema.editId, publishId, name: schema.name, type: schema.type, json: widgets, version, publishedAt: now })
      }
    }

    return JSON.stringify({ success: true, data: { schemaId, diff, description, widgetCount: widgets.length }, summary: diffSummary } satisfies ToolResult)
  },
  {
    name: 'update_schema',
    description: `增量更新已有的 Schema。参数：widgetsJson — 修改后的完整 Widget Schema JSON 字符串；schemaId — 要更新的 Schema ID；description — 本次修改的自然语言描述。`,
    schema: z.object({
      widgetsJson: z.string().describe('修改后的完整 Widget Schema JSON 字符串（数组格式）'),
      schemaId: z.string().optional().describe('要更新的 Schema ID'),
      description: z.string().describe('本次修改的自然语言描述'),
    }),
  },
)

export const editorTools = [
  getSchemaDetailTool,
  searchPublishedSchemasTool,
  getWidgetCatalogueTool,
  searchWidgetsByKeywordTool,
  validateSchemaTool,
  findFlowReferencesTool,
  updateSchemaTool,
]
