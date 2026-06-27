/**
 * MCP Server tests — verifies tool registration and basic invocation via in-memory transport.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createSchemaServer } from '../mcp/schemaServer.js'
import { createFlowServer } from '../mcp/flowServer.js'
import { createWidgetServer } from '../mcp/widgetServer.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// ── Helpers ──

async function setupClientServer(serverFactory: () => McpServer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = serverFactory()
  const client = new Client({ name: 'test-client', version: '1.0.0' })

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return { client, server, clientTransport, serverTransport }
}

async function cleanup(opts: {
  client: Client
  server: McpServer
  clientTransport: InMemoryTransport
  serverTransport: InMemoryTransport
}) {
  await opts.client.close()
  await opts.server.close()
}

// ── Schema MCP Server ──

describe('Schema MCP Server', () => {
  let client: Client
  let server: McpServer
  let clientTransport: InMemoryTransport
  let serverTransport: InMemoryTransport

  beforeEach(async () => {
    ;({ client, server, clientTransport, serverTransport } = await setupClientServer(createSchemaServer))
  })

  afterEach(async () => {
    await cleanup({ client, server, clientTransport, serverTransport })
  })

  it('should register all schema tools', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()

    expect(names).toEqual([
      'schema__find_flow_references',
      'schema__fuzzy_search',
      'schema__get_detail',
      'schema__search',
      'schema__search_published',
      'schema__validate',
      'schema__validate_widgets',
    ])
  })

  it('schema__search tool should have correct parameters', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'schema__search')
    expect(tool).toBeDefined()
    expect(tool!.inputSchema.properties).toHaveProperty('keyword')
    expect(tool!.inputSchema.properties).toHaveProperty('type')
    expect(tool!.inputSchema.properties).toHaveProperty('limit')
    expect(tool!.inputSchema.properties).toHaveProperty('source')
  })

  it('schema__validate should pass for valid schema object', async () => {
    const result = await client.callTool({
      name: 'schema__validate',
      arguments: {
        schema: { name: 'Test', type: 'form', json: [] },
      },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.success).toBe(true)
  })

  it('schema__validate should fail for missing fields', async () => {
    const result = await client.callTool({
      name: 'schema__validate',
      arguments: {
        schema: { name: 'Test' },
      },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.success).toBe(false)
    expect(parsed.errors.length).toBeGreaterThan(0)
  })

  it('schema__validate should reject invalid type', async () => {
    const result = await client.callTool({
      name: 'schema__validate',
      arguments: {
        schema: { name: 'Test', type: 'invalid', json: [] },
      },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.success).toBe(false)
  })
})

// ── Flow MCP Server ──

describe('Flow MCP Server', () => {
  let client: Client
  let server: McpServer
  let clientTransport: InMemoryTransport
  let serverTransport: InMemoryTransport

  beforeEach(async () => {
    ;({ client, server, clientTransport, serverTransport } = await setupClientServer(createFlowServer))
  })

  afterEach(async () => {
    await cleanup({ client, server, clientTransport, serverTransport })
  })

  it('should register all flow tools', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()

    expect(names).toEqual([
      'flow__get_detail',
      'flow__get_node_schema',
      'flow__search',
      'flow__search_users',
      'flow__validate',
    ])
  })

  it('flow__search tool should have correct parameters', async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === 'flow__search')
    expect(tool).toBeDefined()
    expect(tool!.inputSchema.properties).toHaveProperty('keyword')
    expect(tool!.inputSchema.properties).toHaveProperty('status')
    expect(tool!.inputSchema.properties).toHaveProperty('category')
    expect(tool!.inputSchema.properties).toHaveProperty('limit')
  })

  it('flow__validate should pass for valid flow', async () => {
    const result = await client.callTool({
      name: 'flow__validate',
      arguments: {
        flow: {
          nodes: [
            { id: 'n1', data: { bpmnType: 'startEvent' } },
            { id: 'n2', data: { bpmnType: 'userTask', label: '审批', candidateUsers: ['u1'] } },
            { id: 'n3', data: { bpmnType: 'endEvent' } },
          ],
          edges: [
            { id: 'e1', source: { cell: 'n1' }, target: { cell: 'n2' } },
            { id: 'e2', source: { cell: 'n2' }, target: { cell: 'n3' } },
          ],
        },
      },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.data.valid).toBe(true)
  })

  it('flow__validate should fail when missing startEvent', async () => {
    const result = await client.callTool({
      name: 'flow__validate',
      arguments: {
        flow: {
          nodes: [
            { id: 'n1', data: { bpmnType: 'userTask', label: '审批', candidateUsers: ['u1'] } },
            { id: 'n2', data: { bpmnType: 'endEvent' } },
          ],
          edges: [],
        },
      },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.data.valid).toBe(false)
    expect(parsed.data.errors).toContain('缺少 startEvent 开始节点')
  })

  it('flow__validate should fail when userTask has no assignee', async () => {
    const result = await client.callTool({
      name: 'flow__validate',
      arguments: {
        flow: {
          nodes: [
            { id: 'n1', data: { bpmnType: 'startEvent' } },
            { id: 'n2', data: { bpmnType: 'userTask', label: '审批' } },
            { id: 'n3', data: { bpmnType: 'endEvent' } },
          ],
          edges: [
            { id: 'e1', source: { cell: 'n1' }, target: { cell: 'n2' } },
            { id: 'e2', source: { cell: 'n2' }, target: { cell: 'n3' } },
          ],
        },
      },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.data.valid).toBe(false)
    expect(parsed.data.errors.some((e: string) => e.includes('指派人'))).toBe(true)
  })
})

// ── Widget MCP Server ──

describe('Widget MCP Server', () => {
  let client: Client
  let server: McpServer
  let clientTransport: InMemoryTransport
  let serverTransport: InMemoryTransport

  beforeEach(async () => {
    ;({ client, server, clientTransport, serverTransport } = await setupClientServer(createWidgetServer))
  })

  afterEach(async () => {
    await cleanup({ client, server, clientTransport, serverTransport })
  })

  it('should register all widget tools', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()

    expect(names).toEqual([
      'widget__query',
      'widget__validate',
    ])
  })

  it('widget__query should return widget catalogue', async () => {
    const result = await client.callTool({
      name: 'widget__query',
      arguments: {},
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.data.total).toBeGreaterThan(0)
    expect(parsed.data.widgets).toBeDefined()
  })

  it('widget__query should filter by category', async () => {
    const result = await client.callTool({
      name: 'widget__query',
      arguments: { category: 'form' },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.success).toBe(true)
    expect(parsed.data.widgets.every((w: { group: string }) => w.group === 'form')).toBe(true)
  })

  it('widget__validate should pass for valid widgets', async () => {
    const result = await client.callTool({
      name: 'widget__validate',
      arguments: {
        widgets: [
          {
            type: 'form',
            id: 'form_1',
            position: { x: 0, y: 0, w: 24, h: 20 },
            children: [
              { type: 'input', id: 'input_1', position: { x: 0, y: 0, w: 12, h: 2 } },
            ],
          },
        ],
      },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.data.valid).toBe(true)
  })

  it('widget__validate should detect missing type', async () => {
    const result = await client.callTool({
      name: 'widget__validate',
      arguments: {
        widgets: [{ id: 'test_1', position: { x: 0, y: 0, w: 10, h: 10 } }],
      },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.data.valid).toBe(false)
    expect(parsed.data.errors.some((e: { message: string }) => e.message.includes('type'))).toBe(true)
  })

  it('widget__validate should reject top-level non-container widgets', async () => {
    const result = await client.callTool({
      name: 'widget__validate',
      arguments: {
        widgets: [{ type: 'input', id: 'input_1', position: { x: 0, y: 0, w: 12, h: 2 } }],
      },
    })
    const content = result.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed.data.valid).toBe(false)
    expect(parsed.data.errors.some((e: { message: string }) => e.message.includes('容器'))).toBe(true)
  })
})
