/**
 * Unified Schema search tool — resolves the name collision between
 * editorTools (search_schemas) and flowTools (search_schemas).
 *
 * A single tool with a `source` parameter selects the appropriate
 * field set for the calling agent.
 */

import { tool } from '@langchain/core/tools'
import { FormSchemaModel } from '../../models/FormSchema.js'
import { escapeRegex } from '../graph/agentBase.js'
import { z } from 'zod'
import type { ToolResult } from './types.js'

export const searchSchemasTool = tool(
  async ({ keyword, type, limit, source }): Promise<string> => {
    const filter: Record<string, unknown> = {}
    if (keyword) {
      filter.name = { $regex: escapeRegex(keyword), $options: 'i' }
    }
    if (type) {
      filter.type = type
    }

    // Editor needs richer fields; flow only needs basics for binding
    const selectFields = source === 'flow'
      ? '_id name type status version'
      : '_id editId name type status version createdAt updatedAt'

    const schemas = await FormSchemaModel.find(filter)
      .select(selectFields)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean()

    const mapped = schemas.map((s: Record<string, unknown>) => {
      const base: Record<string, unknown> = {
        id: s._id,
        name: s.name,
        type: s.type,
        status: s.status,
        version: s.version,
      }
      if (source !== 'flow') {
        base.editId = s.editId
        base.createdAt = s.createdAt
        base.updatedAt = s.updatedAt
      }
      return base
    })

    const summary = schemas.length === 0
      ? `没有找到${keyword ? `包含"${keyword}"的` : ''}Schema`
      : `找到 ${schemas.length} 个 Schema：${mapped.slice(0, 3).map((s: Record<string, unknown>) => `${s.name}（${s.type}，${s.status}）`).join('、')}${schemas.length > 3 ? '等' : ''}`

    const result: ToolResult = {
      success: true,
      data: { total: schemas.length, schemas: mapped },
      summary,
    }
    return JSON.stringify(result)
  },
  {
    name: 'search_schemas',
    description: `搜索已有的表单 Schema 列表。用于查找现有 Schema 作为参考、查找用户想修改的 Schema、为流程节点绑定表单、或检查是否已存在同名 Schema。

参数说明：
- keyword: 按名称模糊搜索的关键词
- type: 按类型筛选（form=表单，search_list=搜索列表）
- limit: 返回数量上限，默认 10
- source: 调用来源，'editor' 返回完整字段（含 editId、时间戳），'flow' 返回精简字段（仅 id、名称、类型、状态、版本）

返回 JSON 包含 total 数量和 schemas 数组。`,
    schema: z.object({
      keyword: z.string().optional().describe('按名称模糊搜索的关键词'),
      type: z.enum(['form', 'search_list']).optional().describe('按类型筛选'),
      limit: z.number().optional().default(10).describe('返回数量上限，默认 10'),
      source: z.enum(['editor', 'flow']).optional().default('editor')
        .describe('调用来源：editor 返回完整字段，flow 返回精简字段用于节点绑定'),
    }),
  },
)
