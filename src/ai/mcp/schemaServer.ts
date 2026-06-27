/**
 * Schema MCP Server — 通过 MCP 协议暴露 Schema 工具。
 *
 * 使用共享 toolHandlers 层，与 LangGraph 工具共用同一份业务逻辑。
 * 工具名使用 schema__ 前缀实现命名空间隔离。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  handleSchemaSearch,
  handleSchemaGetDetail,
  handleSchemaValidate,
  handleSchemaSearchPublished,
  handleSchemaFuzzySearch,
  handleSchemaFindFlowReferences,
} from '../tools/toolHandlers.js'
import { validateSchemaDocument } from '../services/schemaService.js'

export function createSchemaServer(): McpServer {
  const server = new McpServer({
    name: 'schema-form-schemas',
    version: '2.0.0',
  })

  server.tool(
    'schema__search',
    '搜索表单 Schema 列表，支持按关键词和类型筛选。',
    {
      keyword: z.string().optional().describe('搜索关键词'),
      type: z.enum(['form', 'search_list']).optional().describe('Schema 类型'),
      limit: z.number().default(10).describe('返回数量上限'),
      source: z.enum(['editor', 'flow']).optional().default('editor').describe('调用来源'),
    },
    async (params) => {
      const result = await handleSchemaSearch(params)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  server.tool(
    'schema__get_detail',
    '获取 Schema 完整信息。',
    { schemaId: z.string().describe('Schema ID') },
    async ({ schemaId }) => {
      const result = await handleSchemaGetDetail(schemaId)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: !result.success }
    },
  )

  server.tool(
    'schema__validate',
    '验证 Schema 文档结构。',
    { schema: z.object({}).passthrough().describe('Schema 对象') },
    async ({ schema }) => {
      const result = validateSchemaDocument(schema as Record<string, unknown>)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          success: result.valid, errors: result.errors,
          summary: result.valid ? 'Schema 验证通过' : `发现 ${result.errors.length} 个问题`,
        }) }],
      }
    },
  )

  server.tool(
    'schema__validate_widgets',
    '校验 Widget 数组的结构正确性。',
    { widgets: z.array(z.record(z.unknown())).describe('Widget 数组') },
    async ({ widgets }) => {
      const result = await handleSchemaValidate(widgets)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  server.tool(
    'schema__search_published',
    '搜索已发布的 Schema 版本。',
    {
      keyword: z.string().optional().describe('搜索关键词'),
      type: z.enum(['form', 'search_list']).optional().describe('Schema 类型'),
      limit: z.number().default(10).describe('返回数量上限'),
    },
    async (params) => {
      const result = await handleSchemaSearchPublished(params)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  server.tool(
    'schema__fuzzy_search',
    '基于关键词模糊搜索已有 Schema（Jaccard 相似度）。',
    {
      query: z.string().describe('关键词描述'),
      limit: z.number().default(5).describe('返回数量上限'),
    },
    async ({ query, limit }) => {
      const result = await handleSchemaFuzzySearch(query, limit)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  server.tool(
    'schema__find_flow_references',
    '查找引用了指定 Schema 的所有流程节点。',
    { schemaId: z.string().describe('Schema ID') },
    async ({ schemaId }) => {
      const result = await handleSchemaFindFlowReferences(schemaId)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  return server
}
