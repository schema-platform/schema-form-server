/**
 * MCP → LangGraph 桥接层。
 *
 * 使用 InMemoryTransport 将 MCP Server 的工具转换为 LangGraph StructuredTool。
 * 零网络开销，内存直连。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { StructuredTool } from '@langchain/core/tools'

/**
 * 创建 MCP 内部客户端（InMemoryTransport 直连，不经 SSE）。
 */
async function createInternalClient(factory: () => McpServer): Promise<Client> {
  const server = factory()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)

  const client = new Client(
    { name: 'langgraph-internal', version: '1.0.0' },
  )
  await client.connect(clientTransport)

  return client
}

/**
 * 将 MCP Server 的工具列表转换为 LangGraph StructuredTool[]。
 */
async function convertMcpTools(client: Client): Promise<StructuredTool[]> {
  const { tools: mcpTools } = await client.listTools()

  return mcpTools.map((mcpTool) => {
    const zodSchema = mcpTool.inputSchema
      ? jsonSchemaToZod(mcpTool.inputSchema)
      : z.object({})

    return tool(
      async (params: Record<string, unknown>) => {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: params,
        })
        const textContent = (result.content as Array<{ type: string; text: string }>)
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n')
        return textContent
      },
      {
        name: mcpTool.name,
        description: mcpTool.description ?? '',
        schema: zodSchema,
      },
    )
  })
}

/**
 * 初始化所有 MCP 内部客户端，返回 LangGraph 可用的工具数组。
 */
export async function initMcpBridge(): Promise<StructuredTool[]> {
  const { createSchemaServer } = await import('./schemaServer.js')
  const { createFlowServer } = await import('./flowServer.js')
  const { createWidgetServer } = await import('./widgetServer.js')

  const [schemaClient, flowClient, widgetClient] = await Promise.all([
    createInternalClient(createSchemaServer),
    createInternalClient(createFlowServer),
    createInternalClient(createWidgetServer),
  ])

  const [schemaTools, flowTools, widgetTools] = await Promise.all([
    convertMcpTools(schemaClient),
    convertMcpTools(flowClient),
    convertMcpTools(widgetClient),
  ])

  return [...schemaTools, ...flowTools, ...widgetTools]
}

/**
 * JSON Schema → Zod 转换器（简化版）。
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  if (schema.type === 'object' && schema.properties) {
    const shape: Record<string, z.ZodType> = {}
    const required = (schema.required as string[]) ?? []

    for (const [key, prop] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
      let field = jsonSchemaToZod(prop as Record<string, unknown>)
      if (!required.includes(key)) {
        field = field.optional()
      }
      if (prop.description) {
        field = field.describe(prop.description as string)
      }
      shape[key] = field
    }

    return z.object(shape)
  }

  if (schema.type === 'string') return z.string()
  if (schema.type === 'number') return z.number()
  if (schema.type === 'boolean') return z.boolean()
  if (schema.type === 'array') {
    if (schema.items) return z.array(jsonSchemaToZod(schema.items as Record<string, unknown>))
    return z.array(z.unknown())
  }

  return z.unknown()
}
