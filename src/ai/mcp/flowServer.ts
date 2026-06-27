/**
 * Flow MCP Server — 通过 MCP 协议暴露 Flow 工具。
 *
 * 使用共享 toolHandlers 层，与 LangGraph 工具共用同一份业务逻辑。
 * 工具名使用 flow__ 前缀实现命名空间隔离。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  handleFlowSearch,
  handleFlowGetDetail,
  handleFlowValidate,
  handleFlowSearchUsers,
  handleFlowGetNodeSchema,
} from '../tools/toolHandlers.js'

export function createFlowServer(): McpServer {
  const server = new McpServer({
    name: 'schema-form-flows',
    version: '2.0.0',
  })

  server.tool(
    'flow__search',
    '搜索已有的流程定义。',
    {
      keyword: z.string().optional().describe('按名称/描述模糊搜索'),
      status: z.enum(['draft', 'published', 'archived']).optional().describe('按状态筛选'),
      category: z.string().optional().describe('按分类筛选'),
      limit: z.number().default(10).describe('返回数量上限'),
    },
    async (params) => {
      const result = await handleFlowSearch(params)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  server.tool(
    'flow__get_detail',
    '获取流程定义详情，包括完整 FlowGraph。',
    { flowId: z.string().describe('流程定义的 _id') },
    async ({ flowId }) => {
      const result = await handleFlowGetDetail(flowId)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: !result.success }
    },
  )

  server.tool(
    'flow__validate',
    '校验 FlowGraph 的结构正确性。',
    {
      flow: z.object({
        nodes: z.array(z.record(z.unknown())).describe('流程节点数组'),
        edges: z.array(z.record(z.unknown())).describe('流程边数组'),
      }).describe('要校验的 FlowGraph'),
    },
    async ({ flow }) => {
      const result = await handleFlowValidate(flow)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  server.tool(
    'flow__search_users',
    '搜索用户列表，用于设置审批节点的指派人。',
    {
      keyword: z.string().optional().describe('按用户名/显示名模糊搜索'),
      role: z.string().optional().describe('按角色 ID 筛选'),
      limit: z.number().default(20).describe('返回数量上限'),
    },
    async (params) => {
      const result = await handleFlowSearchUsers(params)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  server.tool(
    'flow__get_node_schema',
    '获取流程节点绑定的表单 Schema 信息。',
    {
      flowId: z.string().describe('流程定义 ID'),
      nodeId: z.string().describe('节点 ID'),
    },
    async ({ flowId, nodeId }) => {
      const result = await handleFlowGetNodeSchema(flowId, nodeId)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: !result.success }
    },
  )

  return server
}
