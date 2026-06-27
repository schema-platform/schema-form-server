/**
 * Flow Agent node.
 *
 * Uses DeepSeek LLM to generate FlowGraph JSON (nodes + edges) from
 * natural language. System prompt dynamically built from @schema-form/ai-shared
 * metadata.
 *
 * Tool execution is handled by ToolNode in the graph — this node only
 * invokes the LLM and returns its response.
 */

import { getLLM } from '../services/llmCache.js'
import { HumanMessage, SystemMessage, AIMessage, AIMessageChunk } from '@langchain/core/messages'
import { buildFlowSystemPrompt } from '@schema-form/ai-shared/promptBuilder'
import { getMetadata } from '../tools/toolHandlers.js'
import { flowTools } from '../tools/flowTools.js'
import { collaborationTools } from '../tools/collaborationTools.js'
import { searchSchemasTool } from '../tools/schemaTools.js'
import { getSchemaDetailTool } from '../tools/editorTools.js'
import { ragSearchTool } from '../tools/ragTools.js'
import { truncateMessagesForLangGraph } from './agentBase.js'
import { callLLMWithFallback } from './agentErrorHandler.js'
import { buildContextInjection, type AgentContextPayload } from './contextCarrier.js'
import { retrieveRagContext } from './ragContextRetriever.js'
import type { AgentStateAnnotation } from './state.js'

// ────────────────────────────────────────────
// System prompt (lazy, cached)
// ────────────────────────────────────────────

let flowSystemPrompt: string | null = null

async function getFlowSystemPrompt(): Promise<string> {
  if (!flowSystemPrompt) {
    flowSystemPrompt = buildFlowSystemPrompt(getMetadata())
  }
  return flowSystemPrompt
}

// ────────────────────────────────────────────
// Context message builder
// ────────────────────────────────────────────

function buildContextMessage(state: typeof AgentStateAnnotation.State): string {
  const lastHumanMessage = [...state.messages]
    .reverse()
    .find((m) => m.constructor.name === 'HumanMessage')

  if (!lastHumanMessage) {
    throw new Error('No user message found in state.')
  }

  let prompt = typeof lastHumanMessage.content === 'string'
    ? lastHumanMessage.content
    : JSON.stringify(lastHumanMessage.content)

  // 多轮迭代：注入当前流程概要 + 结构化详情
  if (state.context.currentFlow && state.context.currentFlow.nodes.length > 0) {
    const flow = state.context.currentFlow
    const nodeCount = flow.nodes.length
    const edgeCount = flow.edges.length
    const nodeTypes = flow.nodes.map(n => (n.data as Record<string, unknown>)?.bpmnType ?? n.type).join(', ')
    prompt += `\n\n--- 当前流程概要 ---\n共 ${nodeCount} 个节点，${edgeCount} 条连线：${nodeTypes}`

    // 多轮迭代：提供节点详情 + 连线关系，帮助 AI 精准修改
    const detailLines: string[] = []
    for (const node of flow.nodes) {
      const data = (node.data ?? {}) as Record<string, unknown>
      const bpmnType = data.bpmnType as string ?? 'unknown'
      const label = data.label as string ?? ''
      const id = node.id as string ?? ''
      detailLines.push(`  - [${bpmnType}] id="${id}" label="${label}"`)
    }
    const edgeLines: string[] = []
    for (const edge of flow.edges) {
      const src = (edge.source as Record<string, unknown>)?.cell as string ?? ''
      const tgt = (edge.target as Record<string, unknown>)?.cell as string ?? ''
      const data = (edge.data ?? {}) as Record<string, unknown>
      const label = data.label as string ?? ''
      edgeLines.push(`  - ${src} → ${tgt}${label ? ` (${label})` : ''}`)
    }
    prompt += `\n\n--- 当前流程节点 ---\n${detailLines.join('\n')}`
    prompt += `\n\n--- 当前流程连线 ---\n${edgeLines.join('\n')}`
    prompt += `\n\n【重要】基于以上结构修改，请使用 update_flow 工具。`
  }

  // Inject current schema summary (flow may reference forms)
  if (state.context.currentSchema && state.context.currentSchema.length > 0) {
    const widgetTypes = state.context.currentSchema.map(w => w.type).join(', ')
    const widgetCount = state.context.currentSchema.length
    prompt += `\n\n--- 当前 Schema 概要 ---\n共 ${widgetCount} 个组件：${widgetTypes}`
  }

  // Inject conversation history summary
  if (state.interaction.historySummary) {
    prompt += `\n\n--- 前文摘要 ---\n${state.interaction.historySummary}`
  }

  // Inject user preferences
  if (state.interaction.preferences && Object.keys(state.interaction.preferences).length > 0) {
    const prefs = Object.entries(state.interaction.preferences)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n')
    prompt += `\n\n--- 用户偏好 ---\n${prefs}`
  }

  // Multi-turn hint with iteration guidance
  if (state.context.turnCount > 1) {
    prompt += `\n\n这是第 ${state.context.turnCount} 轮对话，请基于之前的对话上下文理解和修改。`
    if (state.context.currentFlow && state.context.currentFlow.nodes.length > 0) {
      prompt += `\n\n【重要】当前已有流程，用户可能要求修改。请使用 update_flow 工具提交修改结果，而不是 validate_flow。`
      prompt += `\n修改时请保持未变更部分不变，只修改用户要求变更的部分。在 description 字段中简要说明本次修改内容。`
    }
  }

  // Inject collaboration context from the requesting agent
  const currentStep = state.task.chain[state.task.currentStepIndex]
  if (currentStep?.context && Object.keys(currentStep.context).length > 0) {
    const ctx = currentStep.context as unknown as AgentContextPayload
    if (ctx.sourceAgent && ctx.summary) {
      prompt += buildContextInjection(ctx)
    } else {
      prompt += `\n\n--- 协作上下文（来自其他专家的信息）---\n`
      prompt += JSON.stringify(currentStep.context, null, 2)
    }
  }

  return prompt
}

// ────────────────────────────────────────────
// Flow Agent Node
// ────────────────────────────────────────────

/**
 * Flow agent node — invokes LLM with flow system prompt.
 *
 * The LLM may return tool_calls in its response. LangGraph's
 * conditional edge routes to ToolNode when tool_calls are present,
 * then loops back here with tool results.
 */
export async function flowAgentNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  // RAG: retrieve related schemas for context augmentation
  const lastUserMsg = [...state.messages].reverse().find((m) => m.constructor.name === 'HumanMessage')
  const userQueryText = lastUserMsg
    ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content))
    : ''
  const ragContext = await retrieveRagContext(userQueryText)

  const systemPrompt = await getFlowSystemPrompt()
  const userContent = buildContextMessage(state) + ragContext.context

  const model = (await getLLM({ temperature: 0.7, maxTokens: 8192 })).bindTools([...flowTools, ...collaborationTools, searchSchemasTool, getSchemaDetailTool, ragSearchTool])

  // 截断历史消息以避免 token 超限
  const truncatedHistory = truncateMessagesForLangGraph(state.messages)

  const messages = [
    new SystemMessage(systemPrompt),
    ...truncatedHistory,
    new HumanMessage(userContent),
  ]

  console.log(`[flowAgent] 开始执行, messages=${state.messages.length}`)

  return callLLMWithFallback('flowAgent', async () => {
    const stream = await model.stream(messages)
    let final: AIMessageChunk | null = null
    for await (const chunk of stream) {
      final = final ? final.concat(chunk) : chunk
    }
    if (!final) throw new Error('LLM 返回空流')
    const response = final as unknown as AIMessage
    const hasToolCalls = response.tool_calls && response.tool_calls.length > 0
    console.log(`[flowAgent] LLM 调用完成, hasToolCalls=${hasToolCalls}, contentLength=${typeof response.content === 'string' ? response.content.length : 0}`)
    return { messages: [response] }
  })
}
