/**
 * Schema 共享业务逻辑层。
 *
 * MCP Server 和 LangGraph 工具共同调用，消除重复代码。
 * 所有数据库查询和校验逻辑统一在此。
 */

import { FormSchemaModel } from '../../models/FormSchema.js'
import { PublishedSchemaModel } from '../../models/PublishedSchema.js'
import { escapeRegex } from '../graph/agentBase.js'
import { extractTokens, extractTokensFromSchema, jaccardSimilarity } from './metadataService.js'

// ────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────

export interface SearchSchemasParams {
  keyword?: string
  type?: 'form' | 'search_list'
  limit?: number
  source?: 'editor' | 'flow'
}

export interface SchemaSummary {
  id: string
  editId?: string
  name: string
  type: string
  status: string
  version?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface SchemaDetail {
  id: string
  editId: string
  name: string
  type: string
  status: string
  version: string
  json: unknown
  createdAt: Date
  updatedAt: Date
}

export interface ValidationResult {
  valid: boolean
  errors: Array<{ path: string; message: string }>
}

// ────────────────────────────────────────────
// 搜索
// ────────────────────────────────────────────

export async function searchSchemas(params: SearchSchemasParams): Promise<{
  success: boolean
  data: { total: number; schemas: SchemaSummary[] }
  summary: string
}> {
  const { keyword, type, limit = 10, source = 'editor' } = params

  const filter: Record<string, unknown> = {}
  if (keyword) {
    filter.name = { $regex: escapeRegex(keyword), $options: 'i' }
  }
  if (type) {
    filter.type = type
  }

  const selectFields = source === 'flow'
    ? '_id name type status version'
    : '_id editId name type status version createdAt updatedAt'

  const schemas = await FormSchemaModel.find(filter)
    .select(selectFields)
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean() as Record<string, unknown>[]

  const mapped: SchemaSummary[] = schemas.map((s) => {
    const base: SchemaSummary = {
      id: s._id as string,
      name: s.name as string,
      type: s.type as string,
      status: s.status as string,
      version: s.version as string | undefined,
    }
    if (source !== 'flow') {
      base.editId = s.editId as string
      base.createdAt = s.createdAt as Date
      base.updatedAt = s.updatedAt as Date
    }
    return base
  })

  const summary = mapped.length === 0
    ? `没有找到${keyword ? `包含"${keyword}"的` : ''}Schema`
    : `找到 ${mapped.length} 个 Schema：${mapped.slice(0, 3).map((s) => `${s.name}（${s.type}，${s.status}）`).join('、')}${mapped.length > 3 ? '等' : ''}`

  return { success: true, data: { total: mapped.length, schemas: mapped }, summary }
}

// ────────────────────────────────────────────
// 详情
// ────────────────────────────────────────────

export async function getSchemaDetail(schemaId: string): Promise<{
  success: boolean
  data?: SchemaDetail
  summary?: string
  error?: string
}> {
  const schema = await FormSchemaModel.findById(schemaId).lean() as Record<string, unknown> | null
  if (!schema) {
    return { success: false, error: `Schema ${schemaId} 不存在` }
  }

  const widgetCount = Array.isArray(schema.json) ? (schema.json as unknown[]).length : 0

  return {
    success: true,
    data: {
      id: schema._id as string,
      editId: schema.editId as string,
      name: schema.name as string,
      type: schema.type as string,
      status: schema.status as string,
      version: schema.version as string,
      json: schema.json,
      createdAt: schema.createdAt as Date,
      updatedAt: schema.updatedAt as Date,
    },
    summary: `Schema "${schema.name}"（${schema.type}，${schema.status}）包含 ${widgetCount} 个组件`,
  }
}

// ────────────────────────────────────────────
// 已发布 Schema 搜索
// ────────────────────────────────────────────

export async function searchPublishedSchemas(params: {
  keyword?: string
  type?: 'form' | 'search_list'
  limit?: number
}): Promise<{
  success: boolean
  data: { total: number; schemas: Record<string, unknown>[] }
  summary: string
}> {
  const { keyword, type, limit = 10 } = params

  const filter: Record<string, unknown> = {}
  if (keyword) {
    filter.name = { $regex: escapeRegex(keyword), $options: 'i' }
  }
  if (type) filter.type = type

  const schemas = await PublishedSchemaModel.find(filter)
    .select('_id sourceId name type publishId version publishedAt')
    .sort({ publishedAt: -1 })
    .limit(limit)
    .lean() as Record<string, unknown>[]

  const mapped = schemas.map((s) => ({
    id: s._id,
    sourceId: s.sourceId,
    name: s.name,
    type: s.type,
    publishId: s.publishId,
    version: s.version,
    publishedAt: s.publishedAt,
  }))

  const summary = mapped.length === 0
    ? '没有找到已发布的 Schema'
    : `找到 ${mapped.length} 个已发布 Schema：${mapped.slice(0, 3).map((s) => `${s.name}（v${s.version}）`).join('、')}${mapped.length > 3 ? '等' : ''}`

  return { success: true, data: { total: mapped.length, schemas: mapped }, summary }
}

// ────────────────────────────────────────────
// 文档级校验
// ────────────────────────────────────────────

export function validateSchemaDocument(schema: Record<string, unknown>): ValidationResult {
  const errors: Array<{ path: string; message: string }> = []
  if (!schema.name) errors.push({ path: 'name', message: '缺少 name 字段' })
  if (!schema.type) errors.push({ path: 'type', message: '缺少 type 字段' })
  if (!schema.json) errors.push({ path: 'json', message: '缺少 json 字段' })
  if (schema.type && !['form', 'search_list'].includes(schema.type as string)) {
    errors.push({ path: 'type', message: `无效的 type: ${schema.type}，应为 form 或 search_list` })
  }
  return { valid: errors.length === 0, errors }
}

// ────────────────────────────────────────────
// 组件级校验
// ────────────────────────────────────────────

interface WidgetAIMetadata {
  type: string
  canHaveChildren: boolean
}

let cachedWidgetTypes: Set<string> | null = null
let cachedContainerTypes: Set<string> | null = null

async function getWidgetTypeSets(): Promise<{ VALID_TYPES: Set<string>; CONTAINER_TYPES: Set<string> }> {
  if (!cachedWidgetTypes) {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('@schema-platform/ai-shared/package.json')
    const jsonPath = join(dirname(pkgPath), 'metadata.json')
    const metadata = JSON.parse(readFileSync(jsonPath, 'utf-8')) as { widgets: WidgetAIMetadata[] }
    cachedWidgetTypes = new Set(metadata.widgets.map((w) => w.type))
    cachedContainerTypes = new Set(metadata.widgets.filter((w) => w.canHaveChildren).map((w) => w.type))
  }
  return { VALID_TYPES: cachedWidgetTypes!, CONTAINER_TYPES: cachedContainerTypes! }
}

// ────────────────────────────────────────────
// 模糊搜索（Jaccard 相似度）
// ────────────────────────────────────────────

export async function fuzzySearchSchemas(query: string, limit = 5): Promise<{
  success: boolean
  data: { total: number; schemas: Array<{ id: string; name: string; type: string; status: string; score: number }> }
  summary: string
}> {
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
    id: r.schema._id as string,
    name: r.schema.name as string,
    type: r.schema.type as string,
    status: r.schema.status as string,
    score: Math.round(r.score * 100),
  }))

  const summary = mapped.length === 0
    ? `没有找到与"${query}"相关的 Schema`
    : `找到 ${mapped.length} 个相关 Schema：${mapped.slice(0, 3).map((s) => `${s.name}（匹配度 ${s.score}%）`).join('、')}`

  return { success: true, data: { total: mapped.length, schemas: mapped }, summary }
}

// ────────────────────────────────────────────
// 流程引用查找
// ────────────────────────────────────────────

export async function findFlowReferences(schemaId: string): Promise<{
  success: boolean
  data: { total: number; references: Array<{ flowId: string; flowName: string; nodeId: string; nodeLabel: string; bpmnType: string }> }
  summary: string
}> {
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
          flowId: definitionId,
          flowName: (def?.name as string) ?? 'Unknown',
          nodeId: node.id as string,
          nodeLabel: (data.label as string) ?? (node.id as string),
          bpmnType: (data.bpmnType as string) ?? 'unknown',
        })
      }
    }
  }

  const summary = refs.length === 0
    ? '没有流程节点引用此 Schema'
    : `找到 ${refs.length} 个流程节点引用此 Schema：${refs.slice(0, 3).map((r) => `${r.flowName}/${r.nodeLabel}`).join('、')}${refs.length > 3 ? '等' : ''}`

  return { success: true, data: { total: refs.length, references: refs }, summary }
}

export async function validateWidgetSchema(widgets: Record<string, unknown>[]): Promise<ValidationResult> {
  const { VALID_TYPES, CONTAINER_TYPES } = await getWidgetTypeSets()
  const errors: Array<{ path: string; message: string }> = []

  function walk(nodes: Record<string, unknown>[], prefix: string, depth: number): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const path = prefix ? `${prefix}[${i}]` : `[${i}]`

      const type = node.type as string | undefined
      if (!type) {
        errors.push({ path: `${path}.type`, message: '缺少 type 字段' })
        continue
      }
      if (!VALID_TYPES.has(type)) {
        errors.push({ path: `${path}.type`, message: `无效的组件类型 "${type}"` })
        continue
      }

      const id = node.id as string | undefined
      if (!id) {
        errors.push({ path: `${path}.id`, message: '缺少 id 字段' })
      }

      const pos = node.position as Record<string, unknown> | undefined
      if (!pos || typeof pos !== 'object') {
        errors.push({ path: `${path}.position`, message: '缺少 position 字段' })
      } else {
        for (const key of ['x', 'y', 'w', 'h']) {
          if (typeof pos[key] !== 'number' || (pos[key] as number) < 0) {
            errors.push({ path: `${path}.position.${key}`, message: `position.${key} 必须为非负数` })
          }
        }
      }

      const isContainer = CONTAINER_TYPES.has(type)
      const children = node.children as Record<string, unknown>[] | undefined

      if (isContainer) {
        if (!Array.isArray(children)) {
          errors.push({ path: `${path}.children`, message: `容器组件 "${type}" 必须有 children 数组` })
        } else {
          walk(children, path, depth + 1)
        }
      } else if (depth === 0 && !isContainer) {
        errors.push({ path, message: `基础组件 "${type}" 必须嵌套在布局容器内` })
      }
    }
  }

  walk(widgets, '', 0)
  return { valid: errors.length === 0, errors }
}
