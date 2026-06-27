/**
 * Schema 共享业务逻辑层。
 *
 * MCP Server 和 LangGraph 工具共同调用，消除重复代码。
 * 所有数据库查询和校验逻辑统一在此。
 */

import { FormSchemaModel } from '../../models/FormSchema.js'
import { PublishedSchemaModel } from '../../models/PublishedSchema.js'
import { escapeRegex } from '../graph/agentBase.js'

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
    const pkgPath = require.resolve('@schema-form/ai-shared/package.json')
    const jsonPath = join(dirname(pkgPath), 'metadata.json')
    const metadata = JSON.parse(readFileSync(jsonPath, 'utf-8')) as { widgets: WidgetAIMetadata[] }
    cachedWidgetTypes = new Set(metadata.widgets.map((w) => w.type))
    cachedContainerTypes = new Set(metadata.widgets.filter((w) => w.canHaveChildren).map((w) => w.type))
  }
  return { VALID_TYPES: cachedWidgetTypes!, CONTAINER_TYPES: cachedContainerTypes! }
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
