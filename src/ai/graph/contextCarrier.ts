/**
 * Context Carrier — Agent 间结构化上下文传递机制
 *
 * 问题：多 Agent 协作（task chain）时，上游 Agent 的输出结果
 * 以非结构化方式传递给下游 Agent，导致下游 Agent 缺少关键上下文，
 * 需要多轮对话才能完成任务。
 *
 * 方案：
 * 1. 上游 Agent 完成后，从 state 中提取结构化 context（schema 概要、
 *    flow 概要、工具调用结果摘要等）
 * 2. 将 context 存入 task chain step 的 context 字段
 * 3. 下游 Agent 的 buildContextMessage 中注入 context 摘要
 */

import type { AIMessage, TaskStep } from './state.js'

// ────────────────────────────────────────────
// Context payload types
// ────────────────────────────────────────────

/** Structured context extracted from an agent's output. */
export interface AgentContextPayload {
  /** Which agent produced this context. */
  sourceAgent: 'editor' | 'flow' | 'page' | 'general'
  /** Brief description of what was generated. */
  summary: string
  /** Schema widgets summary (if editor/page agent). */
  schemaSummary?: {
    widgetCount: number
    widgetTypes: string[]
    topFields: string[]
  }
  /** Flow graph summary (if flow agent). */
  flowSummary?: {
    nodeCount: number
    edgeCount: number
    nodeTypes: string[]
    hasBranching: boolean
  }
  /** Key tool call results that downstream agents should know about. */
  toolResults?: Array<{
    toolName: string
    success: boolean
    summary: string
  }>
  /** Raw data for downstream agents that need full details. */
  rawData?: Record<string, unknown>
}

// ────────────────────────────────────────────
// Context extraction
// ────────────────────────────────────────────

/**
 * Extract structured context from the current agent's execution state.
 *
 * Called after an agent node completes (in afterAgent or afterTools),
 * before transitioning to the next task chain step.
 */
export function extractAgentContext(
  state: {
    messages: Array<{ constructor: { name: string }; content?: unknown; tool_calls?: unknown[] }>
    session: { currentAgent: string }
    task: { chain: TaskStep[]; currentStepIndex: number }
    tools: { results: Array<{ name: string; result?: unknown }> }
  },
): AgentContextPayload | null {
  const agent = state.session.currentAgent
  if (agent === 'router' || agent === 'general') return null

  const payload: AgentContextPayload = {
    sourceAgent: agent as AgentContextPayload['sourceAgent'],
    summary: '',
  }

  // Extract schema summary from accumulated messages
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i]
    const name = msg.constructor.name

    // Look for tool calls that produced schemas
    if (name === 'AIMessage' || name === 'AIMessageChunk') {
      const toolCalls = (msg as unknown as { tool_calls?: Array<{ name: string; args: Record<string, unknown> }> }).tool_calls
      if (toolCalls) {
        for (const tc of toolCalls) {
          if (tc.name === 'validate_schema' || tc.name === 'update_schema') {
            const widgetsJson = tc.args?.widgetsJson as string | undefined
            if (widgetsJson) {
              try {
                const widgets = JSON.parse(widgetsJson) as Array<Record<string, unknown>>
                const schemaSummary = extractSchemaSummary(widgets)
                payload.schemaSummary = schemaSummary
                payload.summary += `生成了含 ${schemaSummary.widgetCount} 个组件的 Schema。`
              } catch { /* JSON parse failed, skip */ }
            }
          }
          if (tc.name === 'validate_flow' || tc.name === 'update_flow') {
            const flow = tc.args?.flow as Record<string, unknown> | undefined
            if (flow) {
              const flowSummary = extractFlowSummary(flow)
              payload.flowSummary = flowSummary
              payload.summary += `生成了含 ${flowSummary.nodeCount} 个节点的流程。`
            }
          }
          if (tc.name === 'generate_schema') {
            const desc = tc.args?.description as string | undefined
            if (desc) {
              payload.summary += `使用 generate_schema 工具生成表单：${desc}。`
            }
          }
        }
      }
      break // Only look at the last AI message
    }
  }

  // Extract tool results
  if (state.tools.results.length > 0) {
    payload.toolResults = state.tools.results.map((r) => ({
      toolName: r.name,
      success: !r.result || typeof r.result !== 'object' || !('error' in (r.result as Record<string, unknown>)),
      summary: summarizeToolResult(r.name, r.result),
    }))

    const failedTools = payload.toolResults.filter((t) => !t.success)
    if (failedTools.length > 0) {
      payload.summary += `有 ${failedTools.length} 个工具执行失败。`
    }
  }

  // If no meaningful context was extracted, return null
  if (!payload.summary && !payload.schemaSummary && !payload.flowSummary) {
    return null
  }

  return payload
}

// ────────────────────────────────────────────
// Context injection for downstream agents
// ────────────────────────────────────────────

/**
 * Build a context summary string to inject into the downstream agent's prompt.
 *
 * This is called by each agent's buildContextMessage() to include
 * upstream agent results in the user message.
 */
export function buildContextInjection(context: AgentContextPayload | null | undefined): string {
  if (!context || !context.summary) return ''

  let injection = `\n\n--- 上游 Agent 协作上下文 ---\n`
  injection += `来源: ${context.sourceAgent} 专家\n`
  injection += `摘要: ${context.summary}\n`

  if (context.schemaSummary) {
    const { widgetCount, widgetTypes, topFields } = context.schemaSummary
    injection += `Schema: ${widgetCount} 个组件 (${widgetTypes.slice(0, 8).join(', ')}${widgetTypes.length > 8 ? '...' : ''})`
    if (topFields.length > 0) {
      injection += `，字段: ${topFields.slice(0, 6).join(', ')}${topFields.length > 6 ? '...' : ''}`
    }
    injection += '\n'
  }

  if (context.flowSummary) {
    const { nodeCount, edgeCount, nodeTypes, hasBranching } = context.flowSummary
    injection += `流程: ${nodeCount} 个节点, ${edgeCount} 条连线 (${nodeTypes.join(', ')})`
    if (hasBranching) injection += '，含分支网关'
    injection += '\n'
  }

  if (context.toolResults && context.toolResults.length > 0) {
    injection += `工具调用: ${context.toolResults.map((t) => `${t.toolName}(${t.success ? '成功' : '失败'})`).join(', ')}\n`
  }

  return injection
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function extractSchemaSummary(widgets: Array<Record<string, unknown>>): NonNullable<AgentContextPayload['schemaSummary']> {
  const types: string[] = []
  const fields: string[] = []
  let totalCount = 0

  const extractFromWidget = (w: Record<string, unknown>) => {
    totalCount++
    const type = w.type as string
    if (type) types.push(type)
    const field = w.field as string
    if (field) fields.push(field)
    const children = w.children as Array<Record<string, unknown>> | undefined
    if (children) {
      for (const child of children) extractFromWidget(child)
    }
  }

  for (const w of widgets) extractFromWidget(w)

  return {
    widgetCount: totalCount,
    widgetTypes: [...new Set(types)],
    topFields: [...new Set(fields)],
  }
}

function extractFlowSummary(flow: Record<string, unknown>): NonNullable<AgentContextPayload['flowSummary']> {
  const nodes = (flow.nodes ?? []) as Array<Record<string, unknown>>
  const edges = (flow.edges ?? []) as Array<Record<string, unknown>>

  const nodeTypes: string[] = []
  let hasBranching = false

  for (const node of nodes) {
    const data = node.data as Record<string, unknown> | undefined
    const bpmnType = data?.bpmnType as string ?? node.type as string
    if (bpmnType) nodeTypes.push(bpmnType)
    if (bpmnType === 'exclusiveGateway' || bpmnType === 'parallelGateway' || bpmnType === 'inclusiveGateway') {
      hasBranching = true
    }
  }

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodeTypes: [...new Set(nodeTypes)],
    hasBranching,
  }
}

function summarizeToolResult(toolName: string, result: unknown): string {
  if (!result || typeof result !== 'object') return '无结果'
  const r = result as Record<string, unknown>
  if (r.error) return `错误: ${String(r.error).slice(0, 100)}`
  if (r.success === false) return '执行失败'
  if (r.message) return String(r.message).slice(0, 100)

  // Tool-specific summaries
  if (toolName === 'search_schemas' || toolName === 'search_published_schemas') {
    const data = r.data as Record<string, unknown> | undefined
    return `找到 ${data?.total ?? 0} 个结果`
  }
  if (toolName === 'search_flows') {
    const data = r.data as Record<string, unknown> | undefined
    return `找到 ${data?.total ?? 0} 个流程`
  }

  return '执行成功'
}
