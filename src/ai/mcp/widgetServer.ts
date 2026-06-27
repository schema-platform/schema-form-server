/**
 * Widget MCP Server — 通过 MCP 协议暴露 Widget 工具。
 *
 * 使用共享 toolHandlers 层，与 LangGraph 工具共用同一份业务逻辑。
 * 工具名使用 widget__ 前缀实现命名空间隔离。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { handleWidgetQuery, handleWidgetValidate } from '../tools/toolHandlers.js'

export function createWidgetServer(): McpServer {
  const server = new McpServer({
    name: 'schema-form-widgets',
    version: '2.0.0',
  })

  server.tool(
    'widget__query',
    '获取 Widget 组件目录，可按分类筛选。',
    {
      category: z.enum(['container', 'layout', 'form', 'static', 'action', 'table', 'business', 'chart'])
        .optional().describe('按组件分类筛选'),
    },
    async ({ category }) => {
      const result = handleWidgetQuery(category)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  server.tool(
    'widget__validate',
    '校验 Widget Schema JSON 的结构正确性。',
    { widgets: z.array(z.record(z.unknown())).describe('要校验的 Widget 数组') },
    async ({ widgets }) => {
      const result = await handleWidgetValidate(widgets)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  return server
}
