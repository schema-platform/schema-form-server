/**
 * Shared tool handlers — MCP servers 和 LangGraph tools 共用的业务逻辑。
 *
 * 消除 schemaServer / editorTools / flowServer / flowTools / widgetServer 之间的重复代码。
 * 每个 handler 返回统一的 { success, data, summary } 结构。
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { FormSchemaModel } from '../../models/FormSchema.js'

const require = createRequire(fileURLToPath(import.meta.url))
import {
  searchSchemas,
  getSchemaDetail,
  searchPublishedSchemas,
  validateWidgetSchema,
} from '../services/schemaService.js'
import {
  searchFlows,
  getFlowDetail,
  searchUsers,
  validateFlowGraph,
} from '../services/flowService.js'
import type { ToolResult } from './types.js'

// ────────────────────────────────────────────
// Metadata 加载（单一入口，消除 6 处重复）
// ────────────────────────────────────────────

import type { AIMetadata } from '@schema-form/ai-shared'

let _metadata: AIMetadata | null = null

export function getMetadata(): AIMetadata {
  if (!_metadata) {
    const pkgPath = require.resolve('@schema-form/ai-shared/package.json')
    const jsonPath = join(dirname(pkgPath), 'metadata.json')
    _metadata = JSON.parse(readFileSync(jsonPath, 'utf-8')) as AIMetadata
  }
  return _metadata
}

// ────────────────────────────────────────────
// Token extraction（模糊搜索用）
// ────────────────────────────────────────────

export function extractTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  const englishWords = text.match(/[a-zA-Z]+/g) ?? []
  for (const word of englishWords) tokens.add(word.toLowerCase())
  const chineseChars = text.match(/[一-鿿]+/g) ?? []
  for (const segment of chineseChars) {
    for (let i = 0; i < segment.length - 1; i++) tokens.add(segment.slice(i, i + 2))
    if (segment.length > 0) tokens.add(segment)
  }
  return tokens
}

export function extractTokensFromSchema(json: unknown): Set<string> {
  const tokens = new Set<string>()
  if (!Array.isArray(json)) return tokens
  function walk(nodes: Record<string, unknown>[]): void {
    for (const node of nodes) {
      if (node.type) tokens.add(String(node.type))
      if (node.field) tokens.add(String(node.field))
      if (node.label) { for (const t of extractTokens(String(node.label))) tokens.add(t) }
      if (Array.isArray(node.children)) walk(node.children as Record<string, unknown>[])
    }
  }
  walk(json as Record<string, unknown>[])
  return tokens
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) { if (b.has(item)) intersection++ }
  return intersection / (a.size + b.size - intersection)
}

// ────────────────────────────────────────────
// Schema handlers
// ────────────────────────────────────────────

export async function handleSchemaSearch(params: {
  keyword?: string; type?: 'form' | 'search_list'; limit?: number; source?: 'editor' | 'flow';
}): Promise<ToolResult> {
  return searchSchemas(params) as Promise<ToolResult>
}

export async function handleSchemaGetDetail(schemaId: string): Promise<ToolResult> {
  return getSchemaDetail(schemaId) as Promise<ToolResult>
}

// 容器类型集合（禁止互相嵌套）
const CONTAINER_TYPES = new Set([
  'form', 'double-col', 'triple-col', 'quad-col', 'card', 'drawer', 'modal',
  'tabs', 'collapse', 'fieldset', 'group',
])

export async function handleSchemaValidate(widgets: Record<string, unknown>[]): Promise<ToolResult> {
  const result = await validateWidgetSchema(widgets)

  // 检查容器嵌套违规
  const nestingErrors: Array<{ path: string; message: string }> = []
  function checkNesting(nodes: Record<string, unknown>[], parentType: string | null, path: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const type = node.type as string
      const nodePath = path ? `${path}[${i}]` : `[${i}]`
      const isContainer = CONTAINER_TYPES.has(type)

      if (parentType && isContainer) {
        nestingErrors.push({
          path: nodePath,
          message: `容器 "${type}" 不能嵌套在容器 "${parentType}" 内部。所有组件只允许嵌套在布局组件（grid/flex-row/tabs）内。`,
        })
      }

      if (Array.isArray(node.children)) {
        checkNesting(node.children as Record<string, unknown>[], isContainer ? type : parentType, nodePath)
      }
    }
  }
  checkNesting(widgets, null, '')

  const allErrors = [...result.errors, ...nestingErrors]
  const valid = allErrors.length === 0
  const summary = valid
    ? `Schema 校验通过，共 ${widgets.length} 个组件`
    : `Schema 校验失败，${allErrors.length} 个错误：${allErrors.slice(0, 3).map(e => e.message).join('；')}${allErrors.length > 3 ? '等' : ''}`

  return { success: true, data: { valid, errors: allErrors }, summary }
}

export async function handleSchemaSearchPublished(params: {
  keyword?: string; type?: 'form' | 'search_list'; limit?: number;
}): Promise<ToolResult> {
  return searchPublishedSchemas(params) as Promise<ToolResult>
}

export async function handleSchemaFuzzySearch(query: string, limit = 5): Promise<ToolResult> {
  const allSchemas = await FormSchemaModel.find()
    .select('_id name type status version json createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean() as Record<string, unknown>[]

  const queryTokens = extractTokens(query)
  const scored = allSchemas.map((s) => {
    const nameTokens = extractTokens(String(s.name ?? ''))
    const jsonTokens = extractTokensFromSchema(s.json)
    const allTokens = new Set([...nameTokens, ...jsonTokens])
    const score = jaccardSimilarity(queryTokens, allTokens)
    return { schema: s, score }
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)

  const mapped = scored.map((r) => ({
    id: r.schema._id, name: r.schema.name, type: r.schema.type,
    status: r.schema.status, score: Math.round(r.score * 100),
  }))

  const summary = mapped.length === 0
    ? `没有找到与"${query}"相关的 Schema`
    : `找到 ${mapped.length} 个相关 Schema：${mapped.slice(0, 3).map((s) => `${s.name}（匹配度 ${s.score}%）`).join('、')}`

  return { success: true, data: { total: mapped.length, schemas: mapped }, summary }
}

export async function handleSchemaFindFlowReferences(schemaId: string): Promise<ToolResult> {
  const { FlowVersionModel } = await import('../../flow-models/FlowVersion.js')
  const { FlowDefinitionModel } = await import('../../flow-models/FlowDefinition.js')

  const versions = await FlowVersionModel.find({ 'graph.nodes.data.formSchemaId': schemaId })
    .select('_id definitionId version graph.nodes').lean()

  const refs: Array<{ flowId: string; flowName: string; nodeId: string; nodeLabel: string; bpmnType: string }> = []
  for (const ver of versions) {
    const verData = ver as unknown as Record<string, unknown>
    const graph = verData.graph as Record<string, unknown> | undefined
    const definitionId = verData.definitionId as string
    const def = await FlowDefinitionModel.findById(definitionId).select('_id name').lean() as Record<string, unknown> | null
    const nodes = (graph?.nodes ?? []) as Array<Record<string, unknown>>
    for (const node of nodes) {
      const data = node.data as Record<string, unknown> | undefined
      if (data?.formSchemaId === schemaId) {
        refs.push({
          flowId: definitionId, flowName: (def?.name as string) ?? 'Unknown',
          nodeId: node.id as string, nodeLabel: (data.label as string) ?? (node.id as string),
          bpmnType: (data.bpmnType as string) ?? 'unknown',
        })
      }
    }
  }

  const summary = refs.length === 0
    ? '没有流程节点引用此 Schema'
    : `找到 ${refs.length} 个流程节点引用此 Schema：${refs.slice(0, 3).map(r => `${r.flowName}/${r.nodeLabel}`).join('、')}${refs.length > 3 ? '等' : ''}`

  return { success: true, data: { total: refs.length, references: refs }, summary }
}

// ────────────────────────────────────────────
// Flow handlers
// ────────────────────────────────────────────

export async function handleFlowSearch(params: {
  keyword?: string; status?: 'draft' | 'published' | 'archived'; category?: string; limit?: number;
}): Promise<ToolResult> {
  return searchFlows(params) as Promise<ToolResult>
}

export async function handleFlowGetDetail(flowId: string): Promise<ToolResult> {
  return getFlowDetail(flowId) as Promise<ToolResult>
}

export async function handleFlowValidate(flow: {
  nodes: Record<string, unknown>[]; edges: Record<string, unknown>[];
}): Promise<ToolResult> {
  const result = validateFlowGraph(flow)
  const summary = result.valid
    ? `流程校验通过，${flow.nodes.length} 个节点、${flow.edges.length} 条边`
    : `流程校验失败，${result.errors.length} 个错误：${result.errors.slice(0, 3).join('；')}${result.errors.length > 3 ? '等' : ''}`
  return { success: true, data: { valid: result.valid, errors: result.errors }, summary }
}

export async function handleFlowSearchUsers(params: {
  keyword?: string; role?: string; limit?: number;
}): Promise<ToolResult> {
  return searchUsers(params) as Promise<ToolResult>
}

export async function handleFlowGetNodeSchema(flowId: string, nodeId: string): Promise<ToolResult> {
  const { FlowVersionModel } = await import('../../flow-models/FlowVersion.js')

  const version = await FlowVersionModel.findOne({ definitionId: flowId })
    .sort({ version: -1 }).lean() as Record<string, unknown> | null

  if (!version?.graph) {
    return { success: false, error: `Flow ${flowId} has no version` }
  }

  const nodes = ((version.graph as Record<string, unknown>).nodes ?? []) as Array<Record<string, unknown>>
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) {
    return { success: false, error: `Node ${nodeId} not found in flow ${flowId}` }
  }

  const data = node.data as Record<string, unknown> | undefined
  const formSchemaId = data?.formSchemaId as string | undefined

  if (!formSchemaId) {
    return { success: true, data: { nodeId, hasSchema: false }, summary: `节点 ${nodeId} 未绑定表单` }
  }

  const schema = await FormSchemaModel.findById(formSchemaId)
    .select('_id name type version json').lean() as Record<string, unknown> | null

  return {
    success: true,
    data: {
      nodeId, hasSchema: true, formSchemaId,
      formPublishId: data?.formPublishId, formVersion: data?.formVersion, formMode: data?.formMode,
      schemaName: schema?.name, schemaType: schema?.type,
      widgetCount: Array.isArray(schema?.json) ? (schema.json as unknown[]).length : 0,
    },
    summary: schema
      ? `节点 ${nodeId} 绑定了表单 "${schema.name}"（${formSchemaId}）`
      : `节点 ${nodeId} 引用了 Schema ${formSchemaId}，但该 Schema 已不存在`,
  }
}

// ────────────────────────────────────────────
// Widget handlers
// ────────────────────────────────────────────

export function handleWidgetQuery(category?: string): ToolResult {
  const meta = getMetadata()
  const filtered = category
    ? meta.widgets.filter((w) => w.group === category)
    : meta.widgets

  const groupLabel = category ? `${category} 分组` : '全部'
  const summary = `${groupLabel}共 ${filtered.length} 个组件：${filtered.slice(0, 5).map(w => w.displayName).join('、')}${filtered.length > 5 ? '等' : ''}`

  return { success: true, data: { total: filtered.length, widgets: filtered }, summary }
}

export async function handleWidgetValidate(widgets: Record<string, unknown>[]): Promise<ToolResult> {
  return handleSchemaValidate(widgets)
}
