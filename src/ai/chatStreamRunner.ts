/**
 * AI Chat 流式执行核心逻辑
 *
 * 从 routes.ts 提取的 LangGraph streamEvents 处理循环。
 * HTTP SSE 和 WebSocket 共用此模块，仅通过 send/onDone/onError 回调区分传输层。
 */

import { HumanMessage } from '@langchain/core/messages'
import { isGraphInterrupt } from '@langchain/langgraph'
import { Command } from '@langchain/langgraph'
import { v4 as uuidv4 } from 'uuid'
import { graph } from './graph/graph.js'
import { adaptWidgets } from './services/schemaAdapter.js'
import { createSendError } from './graph/agentErrorHandler.js'
import {
  createConversation,
  getConversation,
  appendMessage,
  maybeGenerateSummary,
} from './services/conversationService.js'
import type { AIMessage as ConversationMessage } from './graph/state.js'
import { createVersion } from './services/versionService.js'
import { FormSchemaModel } from '../models/FormSchema.js'
import { FlowVersionModel } from '../flow-models/FlowVersion.js'
import { PromptVersionModel } from './models/promptVersion.js'
import type { AIMessage } from './graph/state.js'
import { logger } from '../utils/logger.js'

// ────────────────────────────────────────────
// Tool names that produce structured payloads
// ────────────────────────────────────────────

const SCHEMA_TOOLS = new Set(['validate_schema'])
const FLOW_TOOLS = new Set(['validate_flow'])
const UPDATE_SCHEMA_TOOL = 'update_schema'
const UPDATE_FLOW_TOOL = 'update_flow'
const GENERATE_SCHEMA_TOOL = 'generate_schema'
const BIND_TOOLS = new Set(['save_and_bind_schema', 'bind_schema_to_flow_node'])

// ────────────────────────────────────────────
// Interrupted thread tracking for HITL resume
// ────────────────────────────────────────────

interface InterruptedThread {
  conversationId: string
  threadId: string
  interruptValue: unknown
  timestamp: Date
}

const interruptedThreads = new Map<string, InterruptedThread>()

export function getInterruptedThread(threadId: string): InterruptedThread | undefined {
  return interruptedThreads.get(threadId)
}

export function clearInterruptedThread(threadId: string): void {
  interruptedThreads.delete(threadId)
}

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface ChatRequest {
  conversationId?: string
  message: string
  context: {
    source: string
    schemaId?: string
    flowId?: string
    nodeId?: string
    version?: string
    preferences?: Record<string, unknown>
    historySummary?: string
    currentSchema?: Record<string, unknown>[]
    currentFlow?: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }
    selectedWidget?: { id: string; type: string; field?: string; label?: string }
    editorMode?: 'edit' | 'preview'
  }
  mentions?: Array<{ id: string; type: string; name: string }>
}

export interface StreamHandle {
  promise: Promise<void>
  abort: () => void
}

// ────────────────────────────────────────────
// Core: executeChatStream
// ────────────────────────────────────────────

/**
 * 执行一次完整的 chat 流。HTTP 和 WebSocket 都调用此函数。
 *
 * @param request  - 聊天请求参数
 * @param send     - 发送事件到客户端的回调
 * @param onDone   - 流完成时的清理回调
 * @param onError  - 错误时的清理回调（可选）
 */
export function executeChatStream(
  request: ChatRequest,
  send: (event: Record<string, unknown>) => void,
  onDone: (conversationId: string) => void,
  onError?: (error: Error) => void,
): StreamHandle {
  const graphAbort = new AbortController()
  let done = false

  const promise = runChatStream(request, send, graphAbort.signal, (convoId) => {
    done = true
    onDone(convoId)
  }, onError)

  return {
    promise,
    abort: () => {
      if (!done) graphAbort.abort()
    },
  }
}

async function runChatStream(
  request: ChatRequest,
  send: (event: Record<string, unknown>) => void,
  signal: AbortSignal,
  onDone: (conversationId: string) => void,
  onError?: (error: Error) => void,
): Promise<void> {
  const { conversationId, message, context } = request

  // ── Resolve or create conversation ──
  let convo: Awaited<ReturnType<typeof getConversation>> & { _id: string; messages: Array<{ role: string; content: string }> }
  let turnCount = 1

  if (conversationId) {
    const found = await getConversation(conversationId)
    if (!found) {
      send({ type: 'error', content: 'Conversation not found' })
      onDone(conversationId)
      return
    }
    convo = found as typeof convo
    turnCount = convo.messages.filter((m) => m.role === 'user').length + 1
  } else {
    convo = await createConversation({
      source: context.source as 'editor' | 'flow' | 'page' | 'standalone',
      schemaId: context.schemaId,
      flowId: context.flowId,
      nodeId: context.nodeId,
      version: context.version,
    })
  }

  // ── Load current schema if schemaId provided ──
  let currentSchema: Record<string, unknown>[] | undefined
  if (context.schemaId) {
    const schema = await FormSchemaModel.findById(context.schemaId)
    if (schema) {
      if (context.version && schema.version !== context.version) {
        const snapshot = schema.versions.find((v: { version: string }) => v.version === context.version)
        if (snapshot) {
          currentSchema = Array.isArray(snapshot.json)
            ? snapshot.json as Record<string, unknown>[]
            : undefined
        }
      }
      if (!currentSchema && Array.isArray(schema.json)) {
        currentSchema = schema.json as Record<string, unknown>[]
      }
    }
  }
  if (!currentSchema && context.currentSchema && context.currentSchema.length > 0) {
    currentSchema = context.currentSchema
  }

  // ── Load current flow if flowId provided ──
  let currentFlow: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | undefined
  if (context.flowId) {
    const flowVersion = await FlowVersionModel.findOne({ definitionId: context.flowId })
      .sort({ version: -1 })
      .lean() as Record<string, unknown> | null
    if (flowVersion?.graph && typeof flowVersion.graph === 'object') {
      const g = flowVersion.graph as Record<string, unknown>
      currentFlow = {
        nodes: Array.isArray(g.nodes) ? g.nodes as Record<string, unknown>[] : [],
        edges: Array.isArray(g.edges) ? g.edges as Record<string, unknown>[] : [],
      }
    }
  }
  if (!currentFlow && context.currentFlow && context.currentFlow.nodes) {
    currentFlow = context.currentFlow
  }

  // ── Persist user message ──
  const userMessage: ConversationMessage = {
    role: 'user',
    content: message,
    timestamp: new Date(),
  }
  await appendMessage(convo._id, userMessage)

  // ── Build LangGraph input state ──
  const threadId = convo._id
  const graphInput = {
    messages: [new HumanMessage(message)],
    context: {
      source: context.source as 'editor' | 'flow' | 'page' | 'standalone',
      schemaId: context.schemaId,
      flowId: context.flowId,
      nodeId: context.nodeId,
      currentSchema,
      currentFlow,
      selectedWidget: context.selectedWidget,
      editorMode: context.editorMode,
      turnCount,
    },
    session: {
      id: threadId,
      conversationId: convo._id,
      currentAgent: 'router' as const,
    },
    interaction: {
      clarificationRequest: null as string | null,
      clarificationOptions: [] as string[],
      preferences: (context.preferences ?? {}) as Record<string, unknown>,
      historySummary: (request.context.historySummary ?? '') as string,
      collaborationRequest: null as null,
      collaborationHistory: [] as Array<{ from: string; to: string; timestamp: number }>,
    },
  }

  // ── Streaming state ──
  let currentAgent: 'router' | 'editor' | 'flow' | 'page' | 'general' = 'router'
  let accumulatedContent = ''
  let accumulatedThinking = ''
  let accumulatedSchema: Record<string, unknown>[] | null = null
  let accumulatedFlow: Record<string, unknown> | null = null
  const toolCallRegistry: Array<{ id?: string; name: string; arguments: Record<string, unknown>; result?: unknown }> = []
  const pendingPayloads = new Map<string, Record<string, unknown>[] | Record<string, unknown>>()
  let doneSent = false
  let eventCount = 0

  // S3: Think tag state
  let thinkBuffer = ''
  let insideThinkTag = false

  function sendEvent(event: Record<string, unknown>) {
    if (signal.aborted) return
    eventCount++
    const elapsed = Date.now() - graphStartTime
    logger.info({ msg: `[WS:chat] #${eventCount} +${elapsed}ms`, type: event.type as string })
    send(event)
  }

  const graphStartTime = Date.now()

  try {
    const eventStream = graph.streamEvents(graphInput, {
      version: 'v2',
      configurable: { thread_id: threadId },
      recursionLimit: 30,
      signal,
    })

    for await (const event of eventStream) {
      if (signal.aborted) break

      switch (event.event) {
        // ── Node execution start ──
        case 'on_chain_start': {
          const nodeName = event.name as string

          // v2 节点事件
          if (nodeName === 'requirementAnalyzer') {
            sendEvent({ type: 'requirement_analysis_start' })
            break
          }
          if (nodeName === 'taskPlanner') {
            sendEvent({ type: 'task_plan_start' })
            break
          }

          // 原有节点事件
          if (['editor', 'flow', 'page', 'general', 'summarizer'].includes(nodeName)) {
            currentAgent = nodeName === 'summarizer' ? 'general' : nodeName as typeof currentAgent
            sendEvent({ type: 'agent_switch', agent: currentAgent })
          }
          break
        }

        // ── Node finished ──
        case 'on_chain_end': {
          const nodeName = event.name as string

          // v2 节点完成事件
          if (nodeName === 'requirementAnalyzer') {
            const output = event.data?.output as Record<string, unknown> | undefined
            const requirement = output?.requirement as Record<string, unknown> | undefined
            if (requirement?.analysis) {
              sendEvent({
                type: 'requirement_analysis_complete',
                analysis: requirement.analysis,
                needsConfirmation: requirement.needsConfirmation,
              })
            }
            break
          }

          if (nodeName === 'taskPlanner') {
            const output = event.data?.output as Record<string, unknown> | undefined
            const taskPlan = output?.taskPlan as Record<string, unknown> | undefined
            if (taskPlan?.plan) {
              sendEvent({
                type: 'task_plan_complete',
                plan: taskPlan.plan,
              })
            }
            break
          }

          // 原有节点完成事件
          if (nodeName === 'router') {
            const output = event.data?.output as Record<string, unknown> | undefined
            const taskGroup = output?.task as Record<string, unknown> | undefined
            if (taskGroup?.chain && Array.isArray(taskGroup.chain) && taskGroup.chain.length > 0) {
              const steps = taskGroup.chain as Array<{ agent: string; description: string; status: string }>
              sendEvent({
                type: 'chain_step',
                steps: steps.map((s) => ({ agent: s.agent, description: s.description, status: s.status })),
                currentIndex: (taskGroup.currentStepIndex as number) ?? 0,
              })
            }
          }

          if (nodeName === 'editor' || nodeName === 'flow' || nodeName === 'page') {
            const output = event.data?.output as Record<string, unknown> | undefined
            const taskGroup = output?.task as Record<string, unknown> | undefined
            if (taskGroup?.chain && Array.isArray(taskGroup.chain)) {
              const steps = taskGroup.chain as Array<{ agent: string; description: string; status: string }>
              sendEvent({
                type: 'chain_step',
                steps: steps.map((s) => ({ agent: s.agent, description: s.description, status: s.status })),
                currentIndex: (taskGroup.currentStepIndex as number) ?? 0,
              })
            }
          }
          break
        }

        // ── LLM token streaming ──
        case 'on_chat_model_stream': {
          const chunk = event.data?.chunk as {
            content?: unknown
            additional_kwargs?: { reasoning_content?: string }
          } | undefined

          const chunkRec = chunk as Record<string, unknown> | undefined
          const chunkAk = chunk?.additional_kwargs as Record<string, unknown> | undefined
          const reasoningContent =
            chunkAk?.reasoning_content as string | undefined ??
            chunkRec?.reasoning_content as string | undefined ??
            (chunkRec?.lc_kwargs as Record<string, unknown> | undefined)?.additional_kwargs
              ? ((chunkRec?.lc_kwargs as Record<string, unknown>).additional_kwargs as Record<string, unknown> | undefined)?.reasoning_content as string | undefined
              : undefined

          if (reasoningContent && typeof reasoningContent === 'string' && reasoningContent.trim().length > 0) {
            accumulatedThinking += reasoningContent
            sendEvent({ type: 'thinking_delta', content: reasoningContent })
            break
          }

          if (!chunk?.content || typeof chunk.content !== 'string') break

          const content = chunk.content

          // S3: Think tag tracking
          if (insideThinkTag) {
            const closeIdx = content.indexOf('</think>')
            if (closeIdx >= 0) {
              thinkBuffer += content.slice(0, closeIdx)
              if (thinkBuffer.trim().length > 0) {
                accumulatedThinking += thinkBuffer
                sendEvent({ type: 'thinking_delta', content: thinkBuffer })
              }
              thinkBuffer = ''
              insideThinkTag = false
              const remaining = content.slice(closeIdx + 7).trim()
              if (remaining && currentAgent !== 'router') {
                accumulatedContent += remaining
                sendEvent({ type: 'text_delta', content: remaining })
              }
            } else {
              thinkBuffer += content
            }
            break
          }

          const thinkOpenIdx = content.indexOf('<think>')
          if (thinkOpenIdx >= 0) {
            const afterOpen = content.slice(thinkOpenIdx + 7)
            const closeIdx = afterOpen.indexOf('</think>')
            if (closeIdx >= 0) {
              const thinkContent = afterOpen.slice(0, closeIdx)
              if (thinkContent.trim().length > 0) {
                accumulatedThinking += thinkContent
                sendEvent({ type: 'thinking_delta', content: thinkContent })
              }
              const remaining = afterOpen.slice(closeIdx + 7).trim()
              if (remaining && currentAgent !== 'router') {
                accumulatedContent += remaining
                sendEvent({ type: 'text_delta', content: remaining })
              }
            } else {
              insideThinkTag = true
              thinkBuffer = afterOpen
              const beforeThink = content.slice(0, thinkOpenIdx).trim()
              if (beforeThink && currentAgent !== 'router') {
                accumulatedContent += beforeThink
                sendEvent({ type: 'text_delta', content: beforeThink })
              }
            }
            break
          }

          if (currentAgent === 'router') break

          accumulatedContent += content
          sendEvent({ type: 'text_delta', content })
          break
        }

        // ── Tool call started ──
        case 'on_tool_start': {
          const toolName = event.name as string
          const toolArgs = (event.data?.input as Record<string, unknown>) ?? {}

          toolCallRegistry.push({
            id: event.run_id as string | undefined,
            name: toolName,
            arguments: toolArgs,
          })

          sendEvent({
            type: 'tool_call_start',
            tools: [{ id: event.run_id, name: toolName, arguments: toolArgs }],
          })

          if (toolName === 'request_collaboration') {
            const targetAgent = toolArgs.targetAgent as string
            if (['editor', 'flow', 'page'].includes(targetAgent)) {
              sendEvent({
                type: 'agent_switch',
                agent: targetAgent,
                collaboration: true,
                description: toolArgs.description as string,
              })
            }
          }

          if (SCHEMA_TOOLS.has(toolName) && toolArgs.widgetsJson) {
            let parsedWidgets: unknown
            try { parsedWidgets = JSON.parse(toolArgs.widgetsJson as string) } catch { parsedWidgets = null }
            if (parsedWidgets) pendingPayloads.set(event.run_id as string, parsedWidgets as Record<string, unknown>[])
          }
          if (FLOW_TOOLS.has(toolName) && toolArgs.flow) {
            pendingPayloads.set(event.run_id as string, toolArgs.flow as Record<string, unknown>)
          }
          if (toolName === UPDATE_SCHEMA_TOOL && toolArgs.widgetsJson) {
            let parsedWidgets: unknown
            try { parsedWidgets = JSON.parse(toolArgs.widgetsJson as string) } catch { parsedWidgets = null }
            if (parsedWidgets) {
              pendingPayloads.set(event.run_id as string, {
                type: 'update_schema',
                widgets: parsedWidgets,
                schemaId: toolArgs.schemaId,
                description: toolArgs.description,
              })
            }
          }
          if (toolName === UPDATE_FLOW_TOOL && toolArgs.flow) {
            pendingPayloads.set(event.run_id as string, {
              type: 'update_flow',
              flow: toolArgs.flow,
              flowId: toolArgs.flowId,
              description: toolArgs.description,
            })
          }
          break
        }

        // ── Tool call finished ──
        case 'on_tool_end': {
          const toolName = event.name as string
          const toolResult = event.data?.output
          const toolRunId = event.run_id as string

          const entry = toolCallRegistry.find((t) => t.id === toolRunId)
          if (entry) entry.result = toolResult

          const isError = event.data?.error != null
            || (toolResult && typeof toolResult === 'object' && 'error' in (toolResult as Record<string, unknown>))

          if (isError) {
            const rawError = event.data?.error != null
              ? String(event.data.error)
              : String((toolResult as Record<string, unknown>)?.error ?? '')
            const errorMessage = rawError.trim() || '工具执行失败'

            if (entry) entry.result = { error: errorMessage }

            sendEvent({
              type: 'tool_error',
              toolName,
              runId: toolRunId,
              content: errorMessage,
            })
          } else {
            sendEvent({
              type: 'tool_call_end',
              tools: [{ id: toolRunId, name: toolName, result: toolResult }],
            })
          }

          // Emit schema event
          if (SCHEMA_TOOLS.has(toolName)) {
            const payload = pendingPayloads.get(toolRunId)
            if (payload) {
              accumulatedSchema = payload as Record<string, unknown>[]
              sendEvent({ type: 'schema_complete', schema: payload, description: accumulatedContent })
              const v = await createVersion({
                conversationId: convo._id, messageId: toolRunId, type: 'schema',
                content: payload as Record<string, unknown>[], description: '生成 Schema',
              })
              sendEvent({ type: 'version_created', versionId: v._id, version: v.version })
              pendingPayloads.delete(toolRunId)
            }
          }

          // Emit flow event
          if (FLOW_TOOLS.has(toolName)) {
            const payload = pendingPayloads.get(toolRunId)
            if (payload) {
              accumulatedFlow = payload as Record<string, unknown>
              sendEvent({ type: 'flow_complete', flow: payload, description: accumulatedContent })
              const v = await createVersion({
                conversationId: convo._id, messageId: toolRunId, type: 'flow',
                content: payload as Record<string, unknown>, description: '生成流程',
              })
              sendEvent({ type: 'version_created', versionId: v._id, version: v.version })
              pendingPayloads.delete(toolRunId)
            }
          }

          if (toolName === GENERATE_SCHEMA_TOOL) {
            const result = toolResult as Record<string, unknown> | undefined
            const resultData = result?.data as Record<string, unknown> | undefined
            if (resultData?.widgets) {
              sendEvent({ type: 'schema_complete', schema: resultData.widgets, description: (resultData.summary as string) ?? '' })
              const v = await createVersion({
                conversationId: convo._id, messageId: toolRunId, type: 'schema',
                content: resultData.widgets as Record<string, unknown>[], description: (resultData.summary as string) ?? '生成 Schema',
              })
              sendEvent({ type: 'version_created', versionId: v._id, version: v.version })
            }
          }

          if (toolName === UPDATE_SCHEMA_TOOL) {
            const pending = pendingPayloads.get(toolRunId) as Record<string, unknown> | undefined
            const widgetsPayload = pending?.widgets as Record<string, unknown>[] | undefined
            const result = toolResult as Record<string, unknown> | undefined
            const resultData = result?.data as Record<string, unknown> | undefined
            if (widgetsPayload) {
              sendEvent({ type: 'schema_complete', schema: widgetsPayload, description: (resultData?.description as string) ?? '' })
              if (resultData?.diff) {
                sendEvent({ type: 'schema_diff', diff: resultData.diff, description: (resultData?.description as string) ?? '' })
              }
              const v = await createVersion({
                conversationId: convo._id, messageId: toolRunId, type: 'schema',
                content: widgetsPayload, description: (resultData?.description as string) ?? '更新 Schema',
              })
              sendEvent({ type: 'version_created', versionId: v._id, version: v.version })
              pendingPayloads.delete(toolRunId)
            }
          }

          if (toolName === UPDATE_FLOW_TOOL) {
            const result = toolResult as Record<string, unknown> | undefined
            const resultData = result?.data as Record<string, unknown> | undefined
            if (resultData?.flow) {
              sendEvent({ type: 'flow_complete', flow: resultData.flow, description: (resultData.description as string) ?? '' })
              if (resultData.diff) {
                sendEvent({ type: 'flow_diff', diff: resultData.diff, description: (resultData.description as string) ?? '' })
              }
              const v = await createVersion({
                conversationId: convo._id, messageId: toolRunId, type: 'flow',
                content: resultData.flow as Record<string, unknown>, description: (resultData.description as string) ?? '更新流程',
              })
              sendEvent({ type: 'version_created', versionId: v._id, version: v.version })
              pendingPayloads.delete(toolRunId)
            }
          }

          if (BIND_TOOLS.has(toolName)) {
            const result = toolResult as Record<string, unknown> | undefined
            const resultData = result?.data as Record<string, unknown> | undefined
            if (resultData?.schemaId) {
              sendEvent({
                type: 'schema_bound',
                schemaId: resultData.schemaId,
                publishId: resultData.publishId,
                flowId: resultData.flowId,
                nodeId: resultData.nodeId,
                flowVersionId: resultData.flowVersionId,
              })
            }
          }
          break
        }
      }
    }

    // ── Parse <schema> tags from accumulated content ──
    if (accumulatedContent.includes('<schema>')) {
      const schemaMatch = accumulatedContent.match(/<schema>\s*([\s\S]*?)\s*<\/schema>/)
      if (schemaMatch) {
        try {
          const parsed = JSON.parse(schemaMatch[1])
          if (parsed.type === 'flow_update' && parsed.flow) {
            accumulatedFlow = parsed.flow
            sendEvent({ type: 'flow_complete', flow: parsed.flow, description: accumulatedContent.replace(/<[\s\S]*?<\/schema>/, '').trim().slice(0, 200) })
            const v = await createVersion({ conversationId: convo._id, messageId: `text-${Date.now()}`, type: 'flow', content: parsed.flow, description: 'AI 生成流程' })
            sendEvent({ type: 'version_created', versionId: v._id, version: v.version })
          } else if (parsed.type === 'schema_update' && parsed.widgets) {
            const adaptedWidgets = adaptWidgets(parsed.widgets)
            accumulatedSchema = adaptedWidgets
            sendEvent({ type: 'schema_complete', schema: adaptedWidgets, description: accumulatedContent.replace(/<[\s\S]*?<\/schema>/, '').trim().slice(0, 200) })
            const v = await createVersion({ conversationId: convo._id, messageId: `text-${Date.now()}`, type: 'schema', content: adaptedWidgets, description: 'AI 生成 Schema' })
            sendEvent({ type: 'version_created', versionId: v._id, version: v.version })
          }
        } catch {
          // JSON parse failed — skip
        }
      }
    }

    // ── Persist assistant message ──
    const assistantMessage: ConversationMessage = {
      role: 'assistant',
      content: accumulatedContent,
      timestamp: new Date(),
    }
    if (accumulatedThinking) assistantMessage.thinking = accumulatedThinking
    if (toolCallRegistry.length > 0) {
      assistantMessage.toolCalls = toolCallRegistry.map((tc) => ({
        name: tc.name, arguments: tc.arguments, result: tc.result,
      }))
    }
    if (accumulatedSchema) assistantMessage.schema = accumulatedSchema as Record<string, unknown>[]
    if (accumulatedFlow) assistantMessage.flow = accumulatedFlow as Record<string, unknown>

    await appendMessage(convo._id, assistantMessage)

    maybeGenerateSummary(convo._id).catch((err) => { logger.error({ msg: '[WS:chat] maybeGenerateSummary failed', convoId: convo._id, err }) })

    sendEvent({ type: 'done', conversationId: convo._id })
    doneSent = true
    onDone(convo._id)
  } catch (err) {
    if (signal.aborted && !(err instanceof Error && err.name === 'InterruptedError')) {
      // Abort from cancel — silent exit
      logger.info({ msg: `[WS:chat] Graph aborted`, threadId })
      doneSent = true
      return
    }

    // HITL interrupt
    if (isGraphInterrupt(err)) {
      const interruptValue = err.interrupts?.[0]?.value as Record<string, unknown> | undefined
      interruptedThreads.set(threadId, {
        conversationId: convo._id, threadId, interruptValue, timestamp: new Date(),
      })
      sendEvent({
        type: 'interrupt', threadId,
        interruptType: interruptValue?.type ?? 'unknown',
        message: interruptValue?.message ?? '操作需要确认',
        data: interruptValue?.data,
      })
      doneSent = true
      return
    }

    // AbortError
    const isAbortError = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))
    if (isAbortError) {
      sendEvent({ type: 'error', content: '请求已中断' })
      doneSent = true
      return
    }

    // Other errors
    const sendError = createSendError(sendEvent)
    sendError({
      error: err,
      agent: currentAgent,
      phase: accumulatedContent ? 'generating' : 'thinking',
    })
    onError?.(err as Error)
  } finally {
    if (!doneSent && !signal.aborted) {
      sendEvent({ type: 'done', conversationId: convo._id })
    }
  }
}

// ────────────────────────────────────────────
// Core: executeResumeStream
// ────────────────────────────────────────────

export function executeResumeStream(
  threadId: string,
  confirmed: boolean,
  send: (event: Record<string, unknown>) => void,
  onDone: () => void,
): StreamHandle {
  const graphAbort = new AbortController()
  let done = false

  const promise = (async () => {
    try {
      const config = { configurable: { thread_id: threadId } }
      const command = new Command({ resume: confirmed })
      let doneSent = false

      const eventStream = graph.streamEvents(command, {
        version: 'v2',
        configurable: { thread_id: threadId },
        recursionLimit: 30,
        signal: graphAbort.signal,
      })

      for await (const event of eventStream) {
        if (graphAbort.signal.aborted) break

        if (event.event === 'on_chat_model_stream') {
          const chunk = event.data?.chunk as { content?: unknown } | undefined
          if (chunk?.content && typeof chunk.content === 'string') {
            send({ type: 'text_delta', content: chunk.content })
          }
        }

        if (event.event === 'on_tool_start') {
          send({
            type: 'tool_call_start',
            tools: [{ id: event.run_id, name: event.name, arguments: event.data?.input }],
          })
        }

        if (event.event === 'on_tool_end') {
          const toolName = event.name as string
          const toolResult = event.data?.output
          const toolRunId = event.run_id as string

          const isError = event.data?.error != null
            || (toolResult && typeof toolResult === 'object' && 'error' in (toolResult as Record<string, unknown>))

          if (isError) {
            const rawError = event.data?.error != null
              ? String(event.data.error)
              : String((toolResult as Record<string, unknown>)?.error ?? '')
            send({ type: 'tool_error', toolName, runId: toolRunId, content: rawError.trim() || '工具执行失败' })
          } else {
            send({ type: 'tool_call_end', tools: [{ id: toolRunId, name: toolName, result: toolResult }] })
          }
        }
      }

      send({ type: 'done' })
      doneSent = true
    } catch (err) {
      if (graphAbort.signal.aborted) return

      if (isGraphInterrupt(err)) {
        const interruptValue = err.interrupts?.[0]?.value as Record<string, unknown> | undefined
        interruptedThreads.set(threadId, {
          conversationId: threadId, threadId, interruptValue, timestamp: new Date(),
        })
        send({
          type: 'interrupt', threadId,
          interruptType: interruptValue?.type ?? 'unknown',
          message: interruptValue?.message ?? '操作需要确认',
          data: interruptValue?.data,
        })
        return
      }

      const isAbortError = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))
      if (isAbortError) {
        send({ type: 'error', content: '请求已中断' })
        return
      }

      const sendError = createSendError(send)
      sendError({ error: err, phase: 'generating' })
    } finally {
      done = true
      onDone()
    }
  })()

  return {
    promise,
    abort: () => {
      if (!done) graphAbort.abort()
    },
  }
}
