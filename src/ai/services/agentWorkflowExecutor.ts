/**
 * Agent 工作流执行引擎（MVP：顺序 DAG 遍历 + 节点记录持久化）
 *
 * 参考 n8n：每个节点产生一条 AgentNodeRecord，支持 waiting(HITL) 暂停。
 */

import { HumanMessage, SystemMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { AgentWorkflowExecutionModel } from '../models/agentWorkflow.js'
import { getLLM } from './llmCache.js'
import { logger } from '../../utils/logger.js'
import {
  buildEditorSystemPrompt,
  buildFlowSystemPrompt,
  buildPageSystemPrompt,
  ROUTER_SYSTEM_PROMPT,
} from '@schema-platform/ai-shared/promptBuilder'
import { normalizeToolName } from '@schema-platform/ai-shared/toolNames'
import { getToolSync, ensureToolsReady, getToolsByNames } from '../tools/registry.js'
import { getMetadata } from '../tools/toolHandlers.js'
import { extractJsonFromResponse } from '../graph/agentBase.js'
import { getDocumentWithText, reprocessDocumentFromStorage } from './documentService.js'
import type { StructuredTool } from '@langchain/core/tools'

interface WorkflowGraphNode {
  id: string
  type: string
  data?: {
    label?: string
    prompt?: string
    systemPrompt?: string
    model?: string
    agentType?: string
    toolName?: string
    toolArgs?: Record<string, unknown>
    expression?: string
    confirmMessage?: string
    confirmQuestions?: Array<{
      id: string
      question: string
      options?: string[]
      required?: boolean
    }>
    inheritUpstreamQuestions?: boolean
    documentSource?: 'documentId' | 'inputField'
    documentId?: string
    inputField?: string
  }
}

interface WorkflowGraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  data?: { branch?: 'true' | 'false' | 'default' }
}

interface WorkflowGraph {
  entryNodeId: string
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
}

interface ExecuteParams {
  executionId: string
  graph: WorkflowGraph
  input: Record<string, unknown>
  resumeFromWaiting?: boolean
}

interface RuntimeContext {
  input: Record<string, unknown>
  lastOutput: unknown
  nodeOutputs: Record<string, unknown>
}

async function appendNodeRecord(
  executionId: string,
  record: Record<string, unknown>,
) {
  await AgentWorkflowExecutionModel.updateOne(
    { _id: executionId },
    { $push: { nodeRecords: record } },
  )
}

async function updateNodeRecord(
  executionId: string,
  nodeId: string,
  patch: Record<string, unknown>,
) {
  const execution = await AgentWorkflowExecutionModel.findById(executionId)
  if (!execution) return
  const idx = execution.nodeRecords.findIndex((r: { nodeId?: string }) => r.nodeId === nodeId)
  if (idx === -1) return
  Object.assign(execution.nodeRecords[idx], patch)
  execution.markModified('nodeRecords')
  await execution.save()
}

async function finishExecution(
  executionId: string,
  status: 'success' | 'error' | 'waiting' | 'cancelled',
  error?: string,
) {
  const execution = await AgentWorkflowExecutionModel.findById(executionId)
  if (!execution) return
  const finishedAt = new Date()
  execution.status = status
  execution.finishedAt = finishedAt
  execution.durationMs = finishedAt.getTime() - execution.startedAt.getTime()
  if (error) execution.error = error
  await execution.save()
}

function getOutgoingEdges(graph: WorkflowGraph, nodeId: string): WorkflowGraphEdge[] {
  return graph.edges.filter((e) => e.source === nodeId)
}

function getNode(graph: WorkflowGraph, nodeId: string): WorkflowGraphNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId)
}

function resolveTemplate(text: string, ctx: RuntimeContext): string {
  return text
    .replace(/\{\{\$input\.([\w.]+)\}\}/g, (_, key: string) => {
      const val = ctx.input[key]
      return val != null ? String(val) : ''
    })
    .replace(/\{\{\$json\}\}/g, () => JSON.stringify(ctx.lastOutput ?? {}))
    .replace(/\{\{\$node\.([\w-]+)\}\}/g, (_, nodeId: string) => {
      const val = ctx.nodeOutputs[nodeId]
      return val != null ? JSON.stringify(val) : ''
    })
}

function evaluateIfExpression(expression: string, ctx: RuntimeContext): boolean {
  const trimmed = expression.trim()
  if (!trimmed) return true
  try {
    const fn = new Function(
      'input',
      'lastOutput',
      'nodeOutputs',
      `return Boolean(${trimmed})`,
    )
    return fn(ctx.input, ctx.lastOutput, ctx.nodeOutputs) === true
  } catch {
    return false
  }
}

function pickNextNode(
  graph: WorkflowGraph,
  currentId: string,
  branch?: 'true' | 'false',
): string | null {
  const edges = getOutgoingEdges(graph, currentId)
  if (edges.length === 0) return null
  if (branch) {
    const matched = edges.find((e) => e.data?.branch === branch)
    if (matched) return matched.target
  }
  const defaultEdge = edges.find((e) => e.data?.branch === 'default' || !e.data?.branch)
  return (defaultEdge ?? edges[0]).target
}

function resolveTemplateInArgs(
  args: Record<string, unknown>,
  ctx: RuntimeContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      result[key] = resolveTemplate(value, ctx)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string'
          ? resolveTemplate(item, ctx)
          : item && typeof item === 'object'
            ? resolveTemplateInArgs(item as Record<string, unknown>, ctx)
            : item,
      )
    } else if (value && typeof value === 'object') {
      result[key] = resolveTemplateInArgs(value as Record<string, unknown>, ctx)
    } else {
      result[key] = value
    }
  }
  return result
}

async function dispatchTool(
  toolName: string,
  rawArgs: Record<string, unknown>,
  ctx: RuntimeContext,
): Promise<{ output: unknown; error?: string }> {
  const args = resolveTemplateInArgs(rawArgs ?? {}, ctx)
  const normalized = normalizeToolName(toolName)

  if (normalized === 'http_request') {
    try {
      const method = String(args.method ?? 'GET').toUpperCase()
      const url = String(args.url ?? '')
      const headers = (args.headers as Record<string, string>) ?? {}
      const body = args.body != null ? JSON.stringify(args.body) : undefined
      const res = await fetch(url, { method, headers, body })
      const text = await res.text()
      let parsed: unknown = text
      try { parsed = JSON.parse(text) } catch { /* keep text */ }
      return { output: { status: res.status, data: parsed } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { output: { tool: toolName, error: msg }, error: msg }
    }
  }

  try {
    await ensureToolsReady()
    const tool = getToolSync(normalized)
    if (!tool) {
      return {
        output: { tool: toolName, args, message: `工具「${toolName}」未注册` },
        error: `工具「${toolName}」未注册`,
      }
    }

    const rawResult = await tool.invoke(args)
    let output: unknown = rawResult
    if (typeof rawResult === 'string') {
      try {
        output = JSON.parse(rawResult)
      } catch {
        output = rawResult
      }
    }
    return { output }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { output: { tool: toolName, error: msg }, error: msg }
  }
}

// ────────────────────────────────────────────
// HITL 确认问题解析
// ────────────────────────────────────────────

interface HitlConfirmQuestion {
  id: string
  question: string
  options?: string[]
  required?: boolean
}

function normalizeHitlQuestions(raw: unknown[]): HitlConfirmQuestion[] {
  return raw
    .filter((q): q is Record<string, unknown> => q != null && typeof q === 'object')
    .map((q, i) => ({
      id: String(q.id ?? `q${i + 1}`),
      question: String(q.question ?? q.text ?? ''),
      options: Array.isArray(q.options) ? q.options.map(String) : undefined,
      required: q.required !== false,
    }))
    .filter((q) => q.question.trim())
}

function extractConfirmQuestionsFromValue(value: unknown): HitlConfirmQuestion[] {
  if (value == null) return []
  if (typeof value === 'string') {
    try {
      const jsonMatch = value.match(/\{[\s\S]*\}/)
      if (jsonMatch) return extractConfirmQuestionsFromValue(JSON.parse(jsonMatch[0]))
    } catch { /* ignore */ }
    return []
  }
  if (typeof value !== 'object') return []

  const obj = value as Record<string, unknown>
  if (Array.isArray(obj.confirmQuestions)) {
    return normalizeHitlQuestions(obj.confirmQuestions)
  }
  if (obj.analysis && typeof obj.analysis === 'object') {
    const analysis = obj.analysis as Record<string, unknown>
    if (Array.isArray(analysis.confirmQuestions)) {
      return normalizeHitlQuestions(analysis.confirmQuestions)
    }
  }
  if (typeof obj.text === 'string') {
    return extractConfirmQuestionsFromValue(obj.text)
  }
  return []
}

function resolveHitlQuestions(
  data: WorkflowGraphNode['data'],
  ctx: RuntimeContext,
): HitlConfirmQuestion[] {
  const staticQs = normalizeHitlQuestions(
    Array.isArray(data?.confirmQuestions) ? data.confirmQuestions as unknown[] : [],
  )
  const inherit = data?.inheritUpstreamQuestions !== false
  const upstreamQs = inherit ? extractConfirmQuestionsFromValue(ctx.lastOutput) : []

  const seen = new Set<string>()
  const merged: HitlConfirmQuestion[] = []
  for (const q of [...staticQs, ...upstreamQs]) {
    if (seen.has(q.id)) continue
    seen.add(q.id)
    merged.push(q)
  }
  return merged
}

// ────────────────────────────────────────────
// Agent dispatch — 真实调度平台专家 Agent
// ────────────────────────────────────────────

const AGENT_MAX_TOOL_ROUNDS = 3

const EXPERT_NODE_AGENT_MAP: Record<string, string> = {
  'agent-editor': 'editor',
  'agent-flow': 'flow',
  'agent-page': 'page',
  'agent-general': 'general',
}

const VALID_AGENT_TYPES = new Set(['editor', 'flow', 'page', 'general'])

function resolveAgentTypeFromNode(node: WorkflowGraphNode): string | null {
  const mapped = EXPERT_NODE_AGENT_MAP[node.type]
  if (mapped) return mapped
  if (node.type === 'agent') {
    const t = node.data?.agentType ?? 'general'
    return t === 'auto' ? null : t
  }
  return null
}

function normalizeDetectedAgent(value: unknown): string {
  const agent = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return VALID_AGENT_TYPES.has(agent) ? agent : 'general'
}

function getAgentSystemPrompt(agentType: string): string {
  const metadata = getMetadata()
  switch (agentType) {
    case 'editor':
      return buildEditorSystemPrompt(metadata)
    case 'flow':
      return buildFlowSystemPrompt(metadata)
    case 'page':
      return buildPageSystemPrompt(metadata)
    default:
      return '你是通用 AI 助手，请根据上游节点输出完成任务。'
  }
}

function getAgentTools(agentType: string): StructuredTool[] {
  // MCP 工具名（读取/校验/RAG）+ LangGraph 专有工具名（写入/协作）
  const editorToolNames = [
    'schema__search', 'schema__get_detail', 'schema__search_published',
    'schema__fuzzy_search', 'schema__find_flow_references', 'schema__validate_widgets',
    'widget__query', 'rag__search',
    'update_schema', 'generate_schema', 'request_collaboration',
  ]
  const flowToolNames = [
    'flow__search', 'flow__get_detail', 'flow__get_node_schema', 'flow__search_users',
    'flow__validate', 'schema__search', 'schema__get_detail', 'rag__search',
    'update_flow', 'generate_schema', 'save_and_bind_schema', 'bind_schema_to_flow_node',
    'request_collaboration',
  ]
  const pageToolNames = [
    'schema__search', 'schema__get_detail', 'schema__search_published',
    'schema__fuzzy_search', 'schema__validate_widgets', 'widget__query', 'rag__search',
    'update_schema', 'generate_schema', 'request_collaboration',
  ]
  const generalToolNames = ['rag__search']

  switch (agentType) {
    case 'editor':
      return getToolsByNames(editorToolNames)
    case 'flow':
      return getToolsByNames(flowToolNames)
    case 'page':
      return getToolsByNames(pageToolNames)
    default:
      return getToolsByNames(generalToolNames)
  }
}

function autoDetectAgentType(input: unknown, ctx: RuntimeContext): string {
  const text = `${typeof input === 'string' ? input : JSON.stringify(input ?? '')} ${JSON.stringify(ctx.lastOutput ?? '')}`.toLowerCase()
  if (/流程|审批|流转|bpmn|flow|gate|节点|工作流/.test(text)) return 'flow'
  if (/页面|布局|page|layout|landing|仪表盘|统计|列表|详情|表格/.test(text)) return 'page'
  if (/表单|schema|form|字段|组件|widget|输入框/.test(text)) return 'editor'
  return 'general'
}

async function detectAgentIntent(
  input: unknown,
  ctx: RuntimeContext,
): Promise<{ agent: string; source: 'keyword' | 'llm' }> {
  const keywordAgent = autoDetectAgentType(input, ctx)
  if (keywordAgent !== 'general') {
    return { agent: keywordAgent, source: 'keyword' }
  }

  const userText = typeof input === 'string'
    ? input
    : JSON.stringify(input ?? ctx.lastOutput ?? ctx.input ?? {})
  const contextHint = ctx.lastOutput != null
    ? `\n\n[上游节点输出]\n${JSON.stringify(ctx.lastOutput)}`
    : ''

  try {
    const llm = await getLLM({ temperature: 0, maxTokens: 256 })
    const response = await llm.invoke([
      new SystemMessage(ROUTER_SYSTEM_PROMPT),
      new HumanMessage(`${userText}${contextHint}`),
    ])
    const raw = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content)
    const parsed = extractJsonFromResponse(raw)
    if (parsed) {
      if (parsed.target === 'chain' && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        const first = parsed.steps[0] as Record<string, unknown>
        return { agent: normalizeDetectedAgent(first.agent), source: 'llm' }
      }
      if (parsed.target) {
        return { agent: normalizeDetectedAgent(parsed.target), source: 'llm' }
      }
      if (parsed.agent) {
        return { agent: normalizeDetectedAgent(parsed.agent), source: 'llm' }
      }
    }
  } catch (err) {
    logger.warn({
      msg: '[agentWorkflow] intent LLM detection failed, falling back to keyword',
      err: err instanceof Error ? err.message : String(err),
    })
  }

  return { agent: keywordAgent, source: 'keyword' }
}

async function dispatchAgent(
  agentType: string,
  input: unknown,
  ctx: RuntimeContext,
): Promise<{ output: unknown }> {
  // 自动识别：根据输入内容判断使用哪个专家
  let resolvedType = agentType
  if (agentType === 'auto') {
    const detected = await detectAgentIntent(input, ctx)
    resolvedType = detected.agent
  }

  const systemPrompt = getAgentSystemPrompt(resolvedType)
  const tools = getAgentTools(resolvedType)
  const userInput = typeof input === 'string' ? input : JSON.stringify(input ?? ctx.lastOutput ?? {})
  const contextHint = ctx.lastOutput != null
    ? `\n\n[上游节点输出]\n${JSON.stringify(ctx.lastOutput)}`
    : ''

  const llm = await getLLM({ temperature: 0.5, maxTokens: 4096 })
  const boundLLM = tools.length > 0 ? llm.bindTools(tools) : llm

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userInput + contextHint),
  ]

  for (let round = 0; round < AGENT_MAX_TOOL_ROUNDS; round++) {
    const response = await boundLLM.invoke(messages)
    const aiMsg = response as AIMessage
    messages.push(aiMsg)

    const toolCalls = (aiMsg as unknown as { tool_calls?: Array<{ name: string; args: Record<string, unknown>; id: string }> }).tool_calls
    if (!toolCalls || toolCalls.length === 0) {
      const content = typeof aiMsg.content === 'string' ? aiMsg.content : JSON.stringify(aiMsg.content)
      return { output: { text: content, agent: resolvedType } }
    }

    // 执行工具调用
    for (const tc of toolCalls) {
      const matched = tools.find((t) => t.name === tc.name)
      if (matched) {
        try {
          const result = await matched.invoke(tc.args)
          messages.push(new ToolMessage({ content: String(result), tool_call_id: tc.id }))
        } catch (err) {
          messages.push(new ToolMessage({
            content: `工具执行失败: ${err instanceof Error ? err.message : String(err)}`,
            tool_call_id: tc.id,
          }))
        }
      } else {
        messages.push(new ToolMessage({ content: `工具 ${tc.name} 未找到`, tool_call_id: tc.id }))
      }
    }
  }

  // 超过最大轮次，返回最后一条 AI 消息
  const lastMsg = messages[messages.length - 1]
  const content = lastMsg && typeof (lastMsg as AIMessage).content === 'string'
    ? (lastMsg as AIMessage).content
    : 'Agent 达到最大工具调用轮次'
  return { output: { text: content, agent: resolvedType, truncated: true } }
}

async function runNode(
  node: WorkflowGraphNode,
  ctx: RuntimeContext,
): Promise<{ output: unknown; branch?: 'true' | 'false'; wait?: boolean }> {
  const data = node.data ?? {}

  if (node.type === 'tool' || node.type.startsWith('tool-')) {
    const toolName = data.toolName?.trim() ?? ''
    if (!toolName) {
      return { output: { error: '未选择工具' }, branch: undefined }
    }
    const result = await dispatchTool(toolName, data.toolArgs ?? {}, ctx)
    return { output: result.output }
  }

  if (node.type.startsWith('agent-') || node.type === 'agent') {
    const agentInput = data.prompt?.trim() ? resolveTemplate(data.prompt, ctx) : ctx.lastOutput

    if (node.type === 'agent-intent') {
      const { agent: detectedAgent, source } = await detectAgentIntent(agentInput, ctx)
      const result = await dispatchAgent(detectedAgent, agentInput, ctx)
      const output = result.output as Record<string, unknown>
      return {
        output: {
          ...output,
          detectedAgent,
          intentSource: source,
          agent: detectedAgent,
        },
      }
    }

    const agentType = resolveAgentTypeFromNode(node) ?? data.agentType ?? 'general'
    const result = await dispatchAgent(agentType, agentInput, ctx)
    return { output: result.output }
  }

  switch (node.type) {
    case 'manual-trigger':
      return { output: { ...ctx.input } }

    case 'webhook-trigger':
      return { output: { ...ctx.input } }

    case 'document-parse': {
      const source = data.documentSource ?? 'inputField'
      let documentId = ''
      if (source === 'documentId') {
        documentId = resolveTemplate(data.documentId ?? '', ctx).trim()
      } else {
        const field = data.inputField?.trim() || 'documentId'
        const inputObj = ctx.input as Record<string, unknown>
        const lastObj = (ctx.lastOutput ?? {}) as Record<string, unknown>
        const body = inputObj.body as Record<string, unknown> | undefined
        const raw = lastObj[field] ?? inputObj[field] ?? body?.[field]
        documentId = raw != null ? String(raw) : ''
      }
      if (!documentId) {
        return { output: { error: '未指定文档 ID' } }
      }
      const doc = await getDocumentWithText(documentId)
      if (!doc) {
        return { output: { error: `文档不存在: ${documentId}` } }
      }

      let text = doc.text as string
      let chunks = doc.chunks
      let extractionMethod = doc.extractionMethod
      if (!text?.trim() && doc.storagePath && doc.uploadedBy) {
        const reparsed = await reprocessDocumentFromStorage(
          documentId,
          doc.uploadedBy as string,
        )
        if (reparsed) {
          text = reparsed.text as string
          chunks = reparsed.chunks
          extractionMethod = reparsed.extractionMethod
        }
      }

      return {
        output: {
          documentId,
          filename: doc.filename,
          mimetype: doc.mimetype,
          size: doc.size,
          text,
          chunks,
          summary: doc.summary,
          extractionMethod,
          hasOriginalFile: !!doc.storagePath,
          textLength: text?.length ?? 0,
        },
      }
    }

    case 'llm': {
      const prompt = resolveTemplate(data.prompt ?? '', ctx)
      const system = data.systemPrompt?.trim()
        ? resolveTemplate(data.systemPrompt, ctx)
        : '你是工作流中的 LLM 节点，请根据输入完成任务。'
      const modelId = data.model?.trim() && data.model !== 'default' ? data.model : undefined
      const llm = await getLLM({ temperature: 0.3, model: modelId })
      const response = await llm.invoke([
        new SystemMessage(system),
        new HumanMessage(prompt || JSON.stringify(ctx.lastOutput ?? ctx.input)),
      ])
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content)
      return { output: { text: content } }
    }

    case 'if': {
      const result = evaluateIfExpression(data.expression ?? 'true', ctx)
      return { output: { result }, branch: result ? 'true' : 'false' }
    }

    case 'hitl': {
      const confirmQuestions = resolveHitlQuestions(data, ctx)
      return {
        output: {
          message: data.confirmMessage ?? '需要人工确认',
          confirmQuestions,
        },
        wait: true,
      }
    }

    case 'end':
      return { output: ctx.lastOutput }

    default:
      return { output: ctx.lastOutput }
  }
}

export async function executeAgentWorkflow(params: ExecuteParams): Promise<void> {
  const { executionId, graph, input, resumeFromWaiting } = params
  const ctx: RuntimeContext = {
    input,
    lastOutput: input,
    nodeOutputs: {},
  }

  let currentId: string | null = graph.entryNodeId
  const visited = new Set<string>()

  if (resumeFromWaiting) {
    const execution = await AgentWorkflowExecutionModel.findById(executionId)
    const waitingRecord = execution?.nodeRecords
      ?.slice()
      .reverse()
      .find((r: { status?: string }) => r.status === 'waiting')
    if (!waitingRecord?.nodeId) {
      await finishExecution(executionId, 'error', '没有可恢复的等待节点')
      return
    }
    const waitNodeId = waitingRecord.nodeId as string

    // 人工确认：approved === false 表示拒绝，终止执行
    const resumeInput = input as Record<string, unknown>
    if (resumeInput?.approved === false) {
      const reason = (resumeInput.comment as string) ?? '人工拒绝'
      await updateNodeRecord(executionId, waitNodeId, {
        status: 'error',
        output: resumeInput,
        error: reason,
      })
      await finishExecution(executionId, 'cancelled', reason)
      return
    }

    for (const rec of execution?.nodeRecords ?? []) {
      if (rec.status === 'success' && rec.nodeId && rec.output != null) {
        ctx.nodeOutputs[rec.nodeId as string] = rec.output
      }
    }
    ctx.lastOutput = input
    ctx.nodeOutputs[waitNodeId] = input
    await updateNodeRecord(executionId, waitNodeId, {
      status: 'success',
      output: input,
    })
    await AgentWorkflowExecutionModel.updateOne(
      { _id: executionId },
      { $set: { status: 'running', finishedAt: null, durationMs: null, error: null } },
    )
    currentId = pickNextNode(graph, waitNodeId)
    if (!currentId) {
      await finishExecution(executionId, 'success')
      return
    }
  }

  while (currentId) {
    if (visited.has(currentId)) {
      await finishExecution(executionId, 'error', `检测到循环：节点 ${currentId}`)
      return
    }
    visited.add(currentId)

    const node = getNode(graph, currentId)
    if (!node) {
      await finishExecution(executionId, 'error', `节点不存在：${currentId}`)
      return
    }

    const startedAt = new Date()
    const nodeName = node.data?.label ?? node.id

    await appendNodeRecord(executionId, {
      nodeId: node.id,
      nodeType: node.type,
      nodeName,
      status: 'running',
      startedAt,
      input: { lastOutput: ctx.lastOutput, input: ctx.input },
    })

    try {
      const result = await runNode(node, ctx)
      const finishedAt = new Date()
      const durationMs = finishedAt.getTime() - startedAt.getTime()

      if (result.wait) {
        await updateNodeRecord(executionId, node.id, {
          status: 'waiting',
          finishedAt,
          durationMs,
          output: result.output,
        })
        await finishExecution(executionId, 'waiting')
        return
      }

      ctx.lastOutput = result.output
      ctx.nodeOutputs[node.id] = result.output

      await updateNodeRecord(executionId, node.id, {
        status: 'success',
        finishedAt,
        durationMs,
        output: result.output,
      })

      if (node.type === 'end') {
        await finishExecution(executionId, 'success')
        return
      }

      currentId = pickNextNode(graph, node.id, result.branch)
      if (!currentId) {
        await finishExecution(executionId, 'success')
        return
      }
    } catch (err) {
      const finishedAt = new Date()
      const errorMessage = err instanceof Error ? err.message : String(err)
      logger.error({ msg: '[agentWorkflow] node error', nodeId: node.id, err })
      await updateNodeRecord(executionId, node.id, {
        status: 'error',
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: errorMessage,
      })
      await finishExecution(executionId, 'error', errorMessage)
      return
    }
  }

  await finishExecution(executionId, 'success')
}
