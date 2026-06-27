/**
 * AI Agent Graph — StateGraph assembly.
 *
 * Graph structure:
 *   START -> router -> (agentSelector | taskChain) -> ... -> END
 *
 * Nodes:
 * - router: routing decisions (explicit mode, task chain, or LLM analysis)
 * - taskChain: task chain progression management
 * - editor/flow/page/general: expert agents
 * - allTools: tool execution
 * - afterTools: post-tool collaboration extraction
 * - summarizer: multi-step result summary
 */

import { StateGraph, END, START, BaseCheckpointSaver } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { AIMessage, AIMessageChunk, SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { AgentStateAnnotation } from './state.js'
import { editorAgentNode } from './editorAgent.js'
import { flowAgentNode } from './flowAgent.js'
import { pageAgentNode } from './pageAgent.js'
import { allTools } from '../tools/allTools.js'
import { checkpointer } from './checkpointer.js'
import { getLLM } from '../services/llmCache.js'
import { getModelForTask } from './agentBase.js'
import { callLLMWithFallback } from './agentErrorHandler.js'
import { extractAgentContext } from './contextCarrier.js'
import { getMetadata } from '../tools/toolHandlers.js'
import { ROUTER_SYSTEM_PROMPT } from '@schema-form/ai-shared/promptBuilder'
import { logger } from '../../utils/logger.js'
import { requirementAnalyzerNode, routeAfterRequirementAnalyzer } from './requirementAnalyzer.js'
import { taskPlannerNode, routeAfterTaskPlanner } from './taskPlanner.js'

// ────────────────────────────────────────────
// Tool nodes（带错误兜底）
// ────────────────────────────────────────────

const allToolNode = new ToolNode(allTools)

/**
 * 从 state 消息中提取最近一条 AIMessage 的 tool_calls 信息。
 * 用于工具执行异常时记录失败的 tool 名称和输入参数。
 */
function extractPendingToolCalls(state: typeof AgentStateAnnotation.State): Array<{ id: string; name: string; args: Record<string, unknown> }> {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i]
    if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
      return msg.tool_calls.map((tc) => ({
        id: tc.id ?? 'unknown',
        name: tc.name,
        args: tc.args as Record<string, unknown>,
      }))
    }
  }
  return []
}

/**
 * 包装 ToolNode，捕获未预期的异常（如 MongoDB 断连），
 * 返回友好的 ToolMessage 而不是中断图执行。
 *
 * 对每个失败的 tool_call 生成独立的 ToolMessage，
 * 并通过 `ai:thinker:error` 结构化日志记录失败详情。
 */
async function allToolNodeWithErrorHandling(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  try {
    return await allToolNode.invoke(state)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    const pendingTools = extractPendingToolCalls(state)

    // 为每个待执行的 tool_call 生成错误 ToolMessage
    const errorMessages: ToolMessage[] = []

    if (pendingTools.length > 0) {
      for (const tc of pendingTools) {
        // 结构化日志：ai:thinker:error
        logger.error({
          msg: 'ai:thinker:error',
          toolName: tc.name,
          toolInput: tc.args,
          error: errorMessage,
          conversationId: state.session.conversationId,
          agent: state.session.currentAgent,
        })

        errorMessages.push(new ToolMessage({
          content: JSON.stringify({
            success: false,
            error: `工具 ${tc.name} 执行异常: ${errorMessage}`,
            recoverable: true,
          }),
          tool_call_id: tc.id,
          name: tc.name,
        }))
      }
    } else {
      // 无法确定具体 tool，记录通用错误
      logger.error({
        msg: 'ai:thinker:error',
        toolName: 'unknown',
        toolInput: {},
        error: errorMessage,
        conversationId: state.session.conversationId,
        agent: state.session.currentAgent,
      })

      errorMessages.push(new ToolMessage({
        content: JSON.stringify({ success: false, error: '工具执行异常，请重试', recoverable: true }),
        tool_call_id: 'error',
        name: 'system_error',
      }))
    }

    return { messages: errorMessages }
  }
}

// ────────────────────────────────────────────
// Router node — routing decisions only
// ────────────────────────────────────────────

async function routerNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  if (state.context.source === 'editor' || state.context.source === 'flow' || state.context.source === 'page') {
    const agent = state.context.source
    console.log(`[router] 显式模式 source=${agent}, 直接路由到 agentSelector`)
    return { session: { ...state.session, currentAgent: agent }, task: { ...state.task, type: 'generate_simple' }, tools: { ...state.tools, needsTool: true } }
  }

  if (state.task.chain.length > 0) {
    console.log(`[router] 任务链进行中 step=${state.task.currentStepIndex}/${state.task.chain.length}, 路由到 taskChain`)
    return {}
  }

  // 自动模式：关键词快速匹配 + LLM 兜底
  const lower = (state.messages[state.messages.length - 1]?.content as string ?? '').toLowerCase()
  const isFlow = /流程|审批|节点|bpmn|workflow|开始|结束/.test(lower)
  const isPage = /列表|统计|详情|仪表盘|dashboard|搜索列表|数据表格/.test(lower)
  const isForm = /表单|表|输入|填写|编辑/.test(lower)
  const isGeneral = /你好|你是谁|能做什么|帮助|介绍/.test(lower)

  if (isGeneral) {
    console.log(`[router] 关键词匹配 -> general`)
    return { session: { ...state.session, currentAgent: 'general' }, task: { ...state.task, type: 'general' }, tools: { ...state.tools, needsTool: false } }
  }

  // 多意图检测：同时包含页面相关和表单/流程相关关键词时，创建 chain
  if (isPage && (isForm || isFlow)) {
    console.log(`[router] 多意图检测 -> chain (page + ${isForm ? 'form' : 'flow'})`)
    const chain = isForm
      ? [
          { agent: 'page' as const, description: '生成搜索列表页面', status: 'pending' as const },
          { agent: 'editor' as const, description: '生成新增/编辑表单', status: 'pending' as const },
        ]
      : [
          { agent: 'page' as const, description: '生成业务页面', status: 'pending' as const },
          { agent: 'flow' as const, description: '生成审批流程', status: 'pending' as const },
        ]
    return { session: { ...state.session, currentAgent: chain[0].agent }, task: { ...state.task, type: 'generate_simple', chain, currentStepIndex: 0 }, tools: { ...state.tools, needsTool: true } }
  }

  if (isFlow) {
    console.log(`[router] 关键词匹配 -> flow`)
    return { session: { ...state.session, currentAgent: 'flow' }, task: { ...state.task, type: 'generate_simple', chain: [{ agent: 'flow', description: '生成流程', status: 'pending' }], currentStepIndex: 0 }, tools: { ...state.tools, needsTool: true } }
  }

  if (isPage) {
    console.log(`[router] 关键词匹配 -> page`)
    return { session: { ...state.session, currentAgent: 'page' }, task: { ...state.task, type: 'generate_simple', chain: [{ agent: 'page', description: '生成业务页面', status: 'pending' }], currentStepIndex: 0 }, tools: { ...state.tools, needsTool: true } }
  }

  // 关键词无法匹配，使用 LLM 分析（thinker）
  console.log(`[router] 关键词无法匹配，执行 LLM 分析...`)
  try {
    const lastHumanMessage = [...state.messages].reverse().find((m) => m.constructor.name === 'HumanMessage')
    const userContent = lastHumanMessage
      ? (typeof lastHumanMessage.content === 'string' ? lastHumanMessage.content : JSON.stringify(lastHumanMessage.content))
      : ''

    const model = await getLLM({ model: getModelForTask('analyze'), temperature: 0, maxTokens: 4096, jsonMode: true })
    const stream = await model.stream([
      new SystemMessage(ROUTER_SYSTEM_PROMPT),
      new HumanMessage(userContent),
    ])

    let raw = ''
    for await (const chunk of stream) {
      const content = typeof chunk.content === 'string' ? chunk.content : ''
      if (content) raw += content
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { target: string; steps?: Array<{ agent: string; description: string }> }

      if (parsed.target === 'chain' && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        const chain = parsed.steps.map((step) => ({ agent: step.agent as 'editor' | 'flow' | 'page', description: step.description, status: 'pending' as const }))
        console.log(`[router] LLM 链式任务: ${chain.length} 步`)
        return { session: { ...state.session, currentAgent: chain[0].agent }, task: { ...state.task, type: 'generate_simple', chain, currentStepIndex: 0 }, tools: { ...state.tools, needsTool: true } }
      }

      if (parsed.target === 'general') {
        console.log(`[router] LLM 路由到 general`)
        return { session: { ...state.session, currentAgent: 'general' }, task: { ...state.task, type: 'general' }, tools: { ...state.tools, needsTool: false } }
      }
      for (const target of ['flow', 'page'] as const) {
        if (parsed.target === target) {
          console.log(`[router] LLM 路由到 ${target}`)
          return { session: { ...state.session, currentAgent: target }, task: { ...state.task, type: 'generate_simple', chain: [{ agent: target, description: `生成${target}`, status: 'pending' }], currentStepIndex: 0 }, tools: { ...state.tools, needsTool: true } }
        }
      }
    }

    console.log(`[router] LLM 默认路由到 editor`)
    return { session: { ...state.session, currentAgent: 'editor' }, task: { ...state.task, type: 'generate_simple', chain: [{ agent: 'editor', description: '生成表单', status: 'pending' }], currentStepIndex: 0 }, tools: { ...state.tools, needsTool: true } }
  } catch (err) {
    console.warn(`[router] LLM 分析失败，降级到 editor`)
    return { session: { ...state.session, currentAgent: 'editor' }, task: { ...state.task, type: 'generate_simple', chain: [{ agent: 'editor', description: '生成表单', status: 'pending' }], currentStepIndex: 0 }, tools: { ...state.tools, needsTool: true } }
  }
}

// ────────────────────────────────────────────
// Task chain node — chain progression management
// ────────────────────────────────────────────

async function taskChainNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  const currentIndex = state.task.currentStepIndex

  if (state.interaction.collaborationRequest) {
    const { targetAgent, description } = state.interaction.collaborationRequest
    const currentAgent = state.session.currentAgent

    // 协作去重：防止 A→B→A→B 无限循环
    const reverseExists = state.interaction.collaborationHistory.some(
      (h) => h.from === targetAgent && h.to === currentAgent,
    )
    if (reverseExists) {
      console.warn(`[taskChain] 检测到协作循环 ${currentAgent}↔${targetAgent}，跳过`)
      return { interaction: { ...state.interaction, collaborationRequest: null } }
    }

    // Extract context from the current agent before collaboration handoff
    const agentContext = extractAgentContext(state)
    const updatedChain = [...state.task.chain]
    if (agentContext && updatedChain[currentIndex]) {
      updatedChain[currentIndex] = {
        ...updatedChain[currentIndex],
        status: 'done' as const,
        context: agentContext as unknown as Record<string, unknown>,
      }
    }

    const newStep = {
      agent: targetAgent as 'editor' | 'flow' | 'page',
      description: `协作：${description}`,
      status: 'pending' as const,
      context: state.interaction.collaborationRequest.context,
    }

    const finalChain = [
      ...updatedChain.slice(0, currentIndex + 1),
      newStep,
      ...updatedChain.slice(currentIndex + 1),
    ]

    console.log(`[taskChain] 协作请求: 插入 ${targetAgent} 步骤到位置 ${currentIndex + 1}`)

    return {
      session: { ...state.session, currentAgent: targetAgent as 'editor' | 'flow' | 'page' },
      task: { ...state.task, type: 'generate_simple', chain: finalChain, currentStepIndex: currentIndex + 1 },
      tools: { ...state.tools, needsTool: true },
      interaction: {
        ...state.interaction,
        collaborationRequest: null,
        collaborationHistory: [
          ...state.interaction.collaborationHistory,
          { from: currentAgent, to: targetAgent, timestamp: Date.now() },
        ],
      },
    }
  }

  if (currentIndex >= state.task.chain.length) {
    console.log(`[taskChain] 所有步骤完成, 路由到 summarizer`)
    return { session: { ...state.session, currentAgent: 'general' }, task: { ...state.task, type: 'summarize' }, tools: { ...state.tools, needsTool: false } }
  }

  // Extract context from the previous step (if any) and carry it forward
  const updatedChain = state.task.chain.map((step, i) => {
    if (i === currentIndex) return { ...step, status: 'running' as const }
    if (i < currentIndex) return { ...step, status: 'done' as const }
    return step
  })

  // If transitioning from a previous step, extract its context
  if (currentIndex > 0) {
    const prevStep = updatedChain[currentIndex - 1]
    if (!prevStep.context) {
      const agentContext = extractAgentContext(state)
      if (agentContext) {
        updatedChain[currentIndex - 1] = {
          ...prevStep,
          context: agentContext as unknown as Record<string, unknown>,
        }
        console.log(`[taskChain] Context extracted for step ${currentIndex - 1}: ${agentContext.summary}`)
      }
    }
  }

  // Build context injection for the current step from all previous steps
  const currentStep = state.task.chain[currentIndex]
  const upstreamContexts = updatedChain
    .slice(0, currentIndex)
    .filter((s) => s.context)
    .map((s) => s.context)

  let stepContext = currentStep.context
  if (upstreamContexts.length > 0 && !stepContext) {
    // Merge upstream contexts into the current step
    stepContext = {
      upstream: upstreamContexts,
    } as unknown as Record<string, unknown>
  }

  console.log(`[taskChain] 执行步骤 ${currentIndex}: ${currentStep.agent} - ${currentStep.description}`)

  return {
    session: { ...state.session, currentAgent: currentStep.agent as 'editor' | 'flow' | 'page' },
    task: { ...state.task, type: 'generate_simple', chain: updatedChain, currentStepIndex: currentIndex },
    tools: { ...state.tools, needsTool: true },
  }
}

// ────────────────────────────────────────────
// General agent node
// ────────────────────────────────────────────

function buildGeneralSystemPrompt(): string {
  const metadata = getMetadata()
  const widgetCount = metadata.widgets.length
  const flowNodeCount = metadata.flowNodes.length

  const widgetGroups = new Map<string, number>()
  for (const w of metadata.widgets) {
    widgetGroups.set(w.group, (widgetGroups.get(w.group) ?? 0) + 1)
  }
  const widgetSummary = [...widgetGroups.entries()]
    .map(([group, count]) => `${count} 种${group}组件`)
    .join('、')

  return `你是 schema-form-platform 的 AI 助手。

你有四个专家能力：

1. **Editor 专家**：表单/UI 生成 — 精通 ${widgetCount} 种组件（${widgetSummary}），能生成高质量的表单和页面 Schema
2. **Page 专家**：业务页面配置 — 专精统计卡片、详情页、数据列表、搜索列表、仪表盘等业务页面
3. **Flow 专家**：流程/BPMN 生成 — 精通 ${flowNodeCount} 种 BPMN 节点，能生成审批流程、工作流
4. **Workflow 专家**：工作流编排 — 能创建完整的工作流，关联表单 Schema 和流程定义，配置数据更新规则

请用友好、专业的语气回答用户问题。如果用户问你能做什么，引导他们描述具体需求。`
}

async function generalAgentNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  const model = await getLLM({ model: getModelForTask('analyze'), temperature: 0.7, maxTokens: 2048 })
  const systemPrompt = buildGeneralSystemPrompt()

  const lastUserMessage = [...state.messages]
    .reverse()
    .find((m) => m.constructor.name === 'HumanMessage')

  const userContent = lastUserMessage
    ? (typeof lastUserMessage.content === 'string' ? lastUserMessage.content : JSON.stringify(lastUserMessage.content))
    : '你好'

  console.log(`[generalAgent] 开始执行, messages=${state.messages.length}`)

  const result = await callLLMWithFallback('generalAgent', async () => {
    const stream = await model.stream([
      new SystemMessage(systemPrompt),
      new HumanMessage(userContent),
    ])

    let content = ''
    let reasoningContent = ''
    for await (const chunk of stream) {
      const chunkContent = typeof chunk.content === 'string' ? chunk.content : ''
      const chunkReasoning = (chunk as any).additional_kwargs?.reasoning_content ?? (chunk as any).reasoning_content
      if (chunkContent) content += chunkContent
      if (chunkReasoning) reasoningContent += chunkReasoning
    }

    console.log(`[generalAgent] LLM 调用完成, contentLength=${content.length}, reasoningLength=${reasoningContent.length}`)

    const response = new AIMessage({
      content: reasoningContent ? `<think>${reasoningContent}</think>\n\n${content}` : content,
    })

    return { messages: [response] }
  })

  const messages = 'messages' in result ? result.messages : [new AIMessage({ content: '⚠️ AI 处理异常，请重试' })]
  return {
    messages,
    session: { ...state.session, currentAgent: 'general' },
  }
}

// ────────────────────────────────────────────
// Summarizer node
// ────────────────────────────────────────────

const SUMMARIZER_SYSTEM_PROMPT = `你是 schema-form-platform 的 AI 助手。你的任务是对专家智能体的执行结果进行总结。

请以助手身份回答，简洁明了，突出重点，给出后续建议。`

async function summarizerNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  const lastUserMessage = [...state.messages]
    .reverse()
    .find((m) => m.constructor.name === 'HumanMessage')

  const userContent = lastUserMessage
    ? (typeof lastUserMessage.content === 'string' ? lastUserMessage.content : JSON.stringify(lastUserMessage.content))
    : '你好'

  const taskResults = state.task.chain
    .filter((step) => step.status === 'done')
    .map((step) => `✅ ${step.agent} 专家：${step.description}`)
    .join('\n')

  const model = await getLLM({ model: getModelForTask('analyze'), temperature: 0.7, maxTokens: 2048 })

  const prompt = `${SUMMARIZER_SYSTEM_PROMPT}

## 用户需求
${userContent}

## 执行结果
${taskResults || '无'}

请以助手身份总结执行结果，并给出后续建议。`

  // 降级内容：LLM 失败时直接返回任务列表
  const fallbackContent = `## 执行完成\n\n${taskResults || '无执行结果'}\n\n如需进一步调整，请继续描述需求。`

  const result = await callLLMWithFallback('summarizer', async () => {
    const stream = await model.stream([
      new SystemMessage(prompt),
      new HumanMessage(userContent),
    ])

    let content = ''
    for await (const chunk of stream) {
      const chunkContent = typeof chunk.content === 'string' ? chunk.content : ''
      if (chunkContent) content += chunkContent
    }

    return new AIMessage({ content })
  }, fallbackContent)

  const response = result instanceof AIMessage ? result : new AIMessage({ content: fallbackContent })

  return {
    messages: [response],
    session: { ...state.session, currentAgent: 'general' },
  }
}

// ────────────────────────────────────────────
// Conditional edge functions
// ────────────────────────────────────────────

export function routeAfterRouter(
  state: typeof AgentStateAnnotation.State,
): string {
  if (state.context.source === 'editor' || state.context.source === 'flow' || state.context.source === 'page') {
    console.log(`[routeAfterRouter] 显式模式 -> ${state.context.source}`)
    return state.context.source
  }

  if (state.task.chain.length > 0) {
    console.log(`[routeAfterRouter] 任务链 -> taskChain (step=${state.task.currentStepIndex}/${state.task.chain.length})`)
    return 'taskChain'
  }

  // router 已完成 LLM 分析，直接路由到 currentAgent
  const agent = state.session.currentAgent
  console.log(`[routeAfterRouter] 自动模式 -> ${agent}`)
  return agent
}

export function routeAfterTaskChain(
  state: typeof AgentStateAnnotation.State,
): string {
  console.log(`[routeAfterTaskChain] currentAgent=${state.session.currentAgent}, taskType=${state.task.type}`)

  if (state.task.type === 'summarize') {
    console.log(`[routeAfterTaskChain] -> summarizer (任务链完成)`)
    return 'summarizer'
  }

  if (state.session.currentAgent === 'editor') return 'editor'
  if (state.session.currentAgent === 'flow') return 'flow'
  if (state.session.currentAgent === 'page') return 'page'
  if (state.session.currentAgent === 'general') return 'general'

  console.warn(`[routeAfterTaskChain] 未知的 currentAgent="${state.session.currentAgent}", 路由到 END`)
  return END
}

export function afterAgent(
  state: typeof AgentStateAnnotation.State,
): string {
  const lastMessage = state.messages[state.messages.length - 1]
  // 支持 AIMessage 和 AIMessageChunk（invoke 可能返回 Chunk）
  const isAiMessage = lastMessage instanceof AIMessage || lastMessage instanceof AIMessageChunk
  const hasToolCalls = isAiMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0

  console.log(`[afterAgent] source=${state.context.source}, hasToolCalls=${hasToolCalls}, taskChain=${state.task.chain.length}, step=${state.task.currentStepIndex}, messages=${state.messages.length}`)

  const MAX_TOOL_ITERATIONS = 3
  if (hasToolCalls) {
    if (state.tools.toolIterationCount >= MAX_TOOL_ITERATIONS) {
      console.warn(`[afterAgent] 工具迭代上限 ${MAX_TOOL_ITERATIONS}，路由到 summarizer`)
      return 'summarizer'
    }
    console.log(`[afterAgent] -> allTools (${lastMessage.tool_calls!.length} tool_calls)`)
    return 'allTools'
  }

  if (state.context.source === 'standalone' && state.task.chain.length > 0) {
    const nextIndex = state.task.currentStepIndex + 1

    if (nextIndex < state.task.chain.length) {
      console.log(`[afterAgent] -> taskChain (继续任务链 step ${nextIndex}/${state.task.chain.length})`)
      return 'taskChain'
    }

    console.log(`[afterAgent] -> summarizer (任务链完成)`)
    return 'summarizer'
  }

  console.log(`[afterAgent] -> END (显式模式, 无 tool_calls)`)
  return END
}

async function afterToolsNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i]
    if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
      const collaborationCall = msg.tool_calls.find(
        (tc) => tc.name === 'request_collaboration'
      )

      if (collaborationCall) {
        const targetAgent = collaborationCall.args.targetAgent as string
        if (targetAgent === 'editor' || targetAgent === 'flow' || targetAgent === 'page') {
          // Extract context from the current agent before handing off to collaboration
          const agentContext = extractAgentContext(state)
          const updatedChain = [...state.task.chain]
          if (agentContext && updatedChain[state.task.currentStepIndex]) {
            updatedChain[state.task.currentStepIndex] = {
              ...updatedChain[state.task.currentStepIndex],
              context: agentContext as unknown as Record<string, unknown>,
            }
          }

          return {
            tools: { ...state.tools, toolIterationCount: state.tools.toolIterationCount + 1 },
            task: { ...state.task, chain: updatedChain },
            interaction: {
              ...state.interaction,
              collaborationRequest: {
                targetAgent: targetAgent as 'editor' | 'flow' | 'page',
                description: collaborationCall.args.description as string,
                context: collaborationCall.args.context as Record<string, unknown> | undefined,
                conversationId: state.session.conversationId,
              },
            },
          }
        }
      }
      break
    }
  }

  // Extract context for the current task chain step (for downstream agents)
  const agentContext = extractAgentContext(state)
  const updatedChain = [...state.task.chain]
  if (agentContext && updatedChain[state.task.currentStepIndex]) {
    updatedChain[state.task.currentStepIndex] = {
      ...updatedChain[state.task.currentStepIndex],
      context: agentContext as unknown as Record<string, unknown>,
    }
    console.log(`[afterTools] Context extracted for step ${state.task.currentStepIndex}: ${agentContext.summary}`)
  }

  return {
    tools: { ...state.tools, toolIterationCount: state.tools.toolIterationCount + 1 },
    task: updatedChain.length > 0 ? { ...state.task, chain: updatedChain } : state.task,
  }
}

export function afterToolsRoute(
  state: typeof AgentStateAnnotation.State,
): string {
  console.log(`[afterToolsRoute] source=${state.context.source}, taskChain=${state.task.chain.length}, step=${state.task.currentStepIndex}, collaboration=${!!state.interaction.collaborationRequest}`)

  if (state.interaction.collaborationRequest) {
    console.log(`[afterToolsRoute] -> taskChain (协作请求)`)
    return 'taskChain'
  }

  if (state.context.source === 'standalone' && state.task.chain.length > 0) {
    const nextIndex = state.task.currentStepIndex + 1

    if (nextIndex < state.task.chain.length) {
      console.log(`[afterToolsRoute] -> taskChain (继续任务链 step ${nextIndex}/${state.task.chain.length})`)
      return 'taskChain'
    }

    console.log(`[afterToolsRoute] -> summarizer (任务链完成)`)
    return 'summarizer'
  }

  console.log(`[afterToolsRoute] -> ${state.session.currentAgent} (显式模式)`)
  return state.session.currentAgent
}

// ────────────────────────────────────────────
// Build and compile the graph
// ────────────────────────────────────────────

// v2 架构配置
const V2_CONFIG = {
  enableRequirementAnalysis: process.env.AI_ENABLE_REQUIREMENT_ANALYSIS !== 'false',
  enableTaskPlanner: process.env.AI_ENABLE_TASK_PLANNER !== 'false',
}

const builder = new StateGraph(AgentStateAnnotation)
  // 原有节点
  .addNode('router', routerNode)
  .addNode('taskChain', taskChainNode)
  .addNode('editor', editorAgentNode)
  .addNode('flow', flowAgentNode)
  .addNode('page', pageAgentNode)
  .addNode('general', generalAgentNode)
  .addNode('allTools', allToolNodeWithErrorHandling)
  .addNode('afterTools', afterToolsNode)
  .addNode('summarizer', summarizerNode)

  // v2 新增节点
  .addNode('requirementAnalyzer', requirementAnalyzerNode)
  .addNode('taskPlanner', taskPlannerNode)

  // 边的连接
  .addEdge(START, 'router')

  // router 之后：根据配置决定是否启用需求分析
  .addConditionalEdges('router', (state) => {
    // 如果未启用需求分析，使用 v1 路由
    if (!V2_CONFIG.enableRequirementAnalysis) {
      console.log('[router] v1 mode -> routeAfterRouter')
      return routeAfterRouter(state)
    }

    // 所有模式都走需求分析（包括显式模式）
    console.log(`[router] v2 mode -> requirementAnalyzer (source=${state.context.source})`)
    return 'requirementAnalyzer'
  })

  // requirementAnalyzer 之后
  .addConditionalEdges('requirementAnalyzer', routeAfterRequirementAnalyzer)

  // taskPlanner 之后
  .addConditionalEdges('taskPlanner', routeAfterTaskPlanner)

  // taskChain 之后
  .addConditionalEdges('taskChain', routeAfterTaskChain)

  // agent 之后
  .addConditionalEdges('editor', afterAgent)
  .addConditionalEdges('flow', afterAgent)
  .addConditionalEdges('page', afterAgent)

  // general 直接结束
  .addEdge('general', END)

  // 工具调用链
  .addEdge('allTools', 'afterTools')
  .addConditionalEdges('afterTools', afterToolsRoute)

  // 总结
  .addEdge('summarizer', END)

const graph = builder.compile({ checkpointer: checkpointer as unknown as BaseCheckpointSaver })

export { graph, V2_CONFIG }
