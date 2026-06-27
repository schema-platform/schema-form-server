/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import {
  extractAgentContext,
  buildContextInjection,
  type AgentContextPayload,
} from '../graph/contextCarrier.js'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

describe('extractAgentContext', () => {
  function makeState(overrides: Record<string, unknown> = {}) {
    return {
      messages: [],
      session: { currentAgent: 'editor' },
      task: {
        chain: [{ agent: 'editor', description: 'test', status: 'running' }],
        currentStepIndex: 0,
      },
      tools: { results: [] },
      ...overrides,
    }
  }

  it('returns null for router agent', () => {
    const state = makeState({ session: { currentAgent: 'router' } })
    expect(extractAgentContext(state as any)).toBeNull()
  })

  it('returns null for general agent', () => {
    const state = makeState({ session: { currentAgent: 'general' } })
    expect(extractAgentContext(state as any)).toBeNull()
  })

  it('extracts schema summary from validate_schema tool call', () => {
    const widgets = [
      { id: 'form_1', type: 'form', field: 'mainForm', children: [
        { id: 'input_1', type: 'input', field: 'userName' },
        { id: 'select_1', type: 'select', field: 'status' },
      ]},
    ]
    const aiMessage = new AIMessage({
      content: '已生成表单',
      tool_calls: [{
        id: 'tc-1',
        name: 'validate_schema',
        args: { widgetsJson: JSON.stringify(widgets) },
      }],
    })

    const state = makeState({
      messages: [new HumanMessage('做一个表单'), aiMessage],
      session: { currentAgent: 'editor' },
    })

    const context = extractAgentContext(state as any)
    expect(context).not.toBeNull()
    expect(context!.sourceAgent).toBe('editor')
    expect(context!.schemaSummary).toBeDefined()
    expect(context!.schemaSummary!.widgetCount).toBe(3)
    expect(context!.schemaSummary!.widgetTypes).toContain('form')
    expect(context!.schemaSummary!.widgetTypes).toContain('input')
    expect(context!.schemaSummary!.widgetTypes).toContain('select')
    expect(context!.schemaSummary!.topFields).toContain('userName')
    expect(context!.schemaSummary!.topFields).toContain('status')
  })

  it('extracts flow summary from validate_flow tool call', () => {
    const flow = {
      nodes: [
        { id: 'n1', data: { bpmnType: 'startEvent', label: '开始' } },
        { id: 'n2', data: { bpmnType: 'userTask', label: '审批' } },
        { id: 'n3', data: { bpmnType: 'exclusiveGateway', label: '网关' } },
        { id: 'n4', data: { bpmnType: 'endEvent', label: '结束' } },
      ],
      edges: [
        { id: 'e1', source: { cell: 'n1' }, target: { cell: 'n2' } },
        { id: 'e2', source: { cell: 'n2' }, target: { cell: 'n3' } },
        { id: 'e3', source: { cell: 'n3' }, target: { cell: 'n4' } },
      ],
    }

    const aiMessage = new AIMessage({
      content: '已生成流程',
      tool_calls: [{
        id: 'tc-1',
        name: 'validate_flow',
        args: { flow },
      }],
    })

    const state = makeState({
      messages: [new HumanMessage('做一个审批流程'), aiMessage],
      session: { currentAgent: 'flow' },
    })

    const context = extractAgentContext(state as any)
    expect(context).not.toBeNull()
    expect(context!.sourceAgent).toBe('flow')
    expect(context!.flowSummary).toBeDefined()
    expect(context!.flowSummary!.nodeCount).toBe(4)
    expect(context!.flowSummary!.edgeCount).toBe(3)
    expect(context!.flowSummary!.nodeTypes).toContain('startEvent')
    expect(context!.flowSummary!.nodeTypes).toContain('userTask')
    expect(context!.flowSummary!.hasBranching).toBe(true)
  })

  it('extracts tool results', () => {
    const state = makeState({
      messages: [new HumanMessage('搜索表单')],
      session: { currentAgent: 'editor' },
      tools: {
        results: [
          { name: 'search_schemas', result: { success: true, data: { total: 5 } } },
          { name: 'search_flows', result: { error: '连接超时' } },
        ],
      },
    })

    const context = extractAgentContext(state as any)
    expect(context).not.toBeNull()
    expect(context!.toolResults).toHaveLength(2)
    expect(context!.toolResults![0].toolName).toBe('search_schemas')
    expect(context!.toolResults![0].success).toBe(true)
    expect(context!.toolResults![1].toolName).toBe('search_flows')
    expect(context!.toolResults![1].success).toBe(false)
    expect(context!.summary).toContain('1 个工具执行失败')
  })

  it('returns null when no meaningful context is extracted', () => {
    const aiMessage = new AIMessage({ content: '你好，我是 AI 助手。' })
    const state = makeState({
      messages: [new HumanMessage('你好'), aiMessage],
      session: { currentAgent: 'editor' },
    })

    // No tool calls, no schema/flow, no tool results -> null
    expect(extractAgentContext(state as any)).toBeNull()
  })
})

describe('buildContextInjection', () => {
  it('returns empty string for null context', () => {
    expect(buildContextInjection(null)).toBe('')
  })

  it('returns empty string for undefined context', () => {
    expect(buildContextInjection(undefined)).toBe('')
  })

  it('builds injection with schema summary', () => {
    const context: AgentContextPayload = {
      sourceAgent: 'editor',
      summary: '生成了含 3 个组件的 Schema。',
      schemaSummary: {
        widgetCount: 3,
        widgetTypes: ['form', 'input', 'select'],
        topFields: ['userName', 'status'],
      },
    }

    const injection = buildContextInjection(context)
    expect(injection).toContain('上游 Agent 协作上下文')
    expect(injection).toContain('editor 专家')
    expect(injection).toContain('3 个组件')
    expect(injection).toContain('form')
    expect(injection).toContain('input')
    expect(injection).toContain('userName')
  })

  it('builds injection with flow summary', () => {
    const context: AgentContextPayload = {
      sourceAgent: 'flow',
      summary: '生成了含 4 个节点的流程。',
      flowSummary: {
        nodeCount: 4,
        edgeCount: 3,
        nodeTypes: ['startEvent', 'userTask', 'endEvent'],
        hasBranching: true,
      },
    }

    const injection = buildContextInjection(context)
    expect(injection).toContain('4 个节点')
    expect(injection).toContain('3 条连线')
    expect(injection).toContain('含分支网关')
  })

  it('builds injection with tool results', () => {
    const context: AgentContextPayload = {
      sourceAgent: 'editor',
      summary: '已生成表单。',
      toolResults: [
        { toolName: 'search_schemas', success: true, summary: '找到 5 个结果' },
        { toolName: 'validate_schema', success: false, summary: '校验失败' },
      ],
    }

    const injection = buildContextInjection(context)
    expect(injection).toContain('search_schemas(成功)')
    expect(injection).toContain('validate_schema(失败)')
  })

  it('truncates long widget type lists', () => {
    const context: AgentContextPayload = {
      sourceAgent: 'editor',
      summary: '生成了含 12 个组件的 Schema。',
      schemaSummary: {
        widgetCount: 12,
        widgetTypes: ['form', 'input', 'select', 'number', 'date', 'checkbox', 'radio', 'textarea', 'upload', 'table', 'button', 'card'],
        topFields: [],
      },
    }

    const injection = buildContextInjection(context)
    // Should truncate with "..." after 8 types
    expect(injection).toContain('...')
  })
})
