/**
 * Task Planner Node
 *
 * 根据确认后的需求生成动态任务链。
 * 支持依赖关系、优先级排序、执行策略。
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { getLLM } from '../services/llmCache.js'
import { getModelForTask } from './agentBase.js'
import { logger } from '../../utils/logger.js'
import type { AgentStateAnnotation, TaskPlan, TaskPlanStep } from './state.js'

// ────────────────────────────────────────────
// System Prompt
// ────────────────────────────────────────────

const TASK_PLANNER_PROMPT = `你是一个任务规划专家，负责将用户需求拆解为可执行的任务链。

## 你的任务

1. **分析需求**
   - 理解用户想要创建/修改的内容
   - 识别涉及的实体类型（表单、流程、页面）

2. **拆解任务**
   - 将复杂需求拆解为多个步骤
   - 每个步骤对应一个 Agent（editor/flow/page）
   - 明确每个步骤的输入和输出

3. **确定依赖关系**
   - 哪些步骤需要先完成
   - 哪些步骤可以并行执行
   - 数据如何在步骤间传递

4. **选择执行策略**
   - sequential: 顺序执行，步骤间有依赖
   - parallel: 并行执行，步骤间无依赖
   - mixed: 部分并行，部分顺序

## Agent 能力

- **editor**: 生成/编辑表单 Schema，输出 schemaId
- **flow**: 生成/编辑流程，输出 flowId，可绑定 schemaId
- **page**: 生成页面，可关联 schemaId 或 flowId

## 输出格式

请输出严格的 JSON 格式：

\`\`\`json
{
  "chain": [
    {
      "id": "step-1",
      "agent": "editor",
      "description": "生成订单录入表单",
      "inputs": {},
      "outputs": { "schemaId": "step-1.schemaId" },
      "dependencies": [],
      "priority": 1,
      "status": "pending"
    },
    {
      "id": "step-2",
      "agent": "flow",
      "description": "生成订单审批流程",
      "inputs": { "schemaId": "step-1.schemaId" },
      "outputs": { "flowId": "step-2.flowId" },
      "dependencies": ["step-1"],
      "priority": 2,
      "status": "pending"
    }
  ],
  "strategy": {
    "mode": "sequential",
    "retryPolicy": "simple",
    "timeout": 300000
  },
  "contextFlow": [
    {
      "from": "step-1",
      "to": "step-2",
      "data": ["schemaId"]
    }
  ]
}
\`\`\`

## 示例

输入：创建一个订单管理系统，包含订单录入、审批流程和订单列表

输出：
\`\`\`json
{
  "chain": [
    {
      "id": "step-1",
      "agent": "editor",
      "description": "生成订单录入表单",
      "inputs": {},
      "outputs": { "schemaId": "step-1.schemaId" },
      "dependencies": [],
      "priority": 1,
      "status": "pending"
    },
    {
      "id": "step-2",
      "agent": "flow",
      "description": "生成订单审批流程",
      "inputs": { "schemaId": "step-1.schemaId" },
      "outputs": { "flowId": "step-2.flowId" },
      "dependencies": ["step-1"],
      "priority": 2,
      "status": "pending"
    },
    {
      "id": "step-3",
      "agent": "page",
      "description": "生成订单列表页面",
      "inputs": { "flowId": "step-2.flowId" },
      "outputs": {},
      "dependencies": ["step-2"],
      "priority": 3,
      "status": "pending"
    }
  ],
  "strategy": {
    "mode": "sequential",
    "retryPolicy": "simple",
    "timeout": 300000
  },
  "contextFlow": [
    { "from": "step-1", "to": "step-2", "data": ["schemaId"] },
    { "from": "step-2", "to": "step-3", "data": ["flowId"] }
  ]
}
\`\`\`
`

// ────────────────────────────────────────────
// Helper functions
// ────────────────────────────────────────────

function parsePlanResponse(raw: string): TaskPlan | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.error({ msg: '[taskPlanner] No JSON found in response' })
      return null
    }

    const parsed = JSON.parse(jsonMatch[0]) as TaskPlan

    // 验证必需字段
    if (!parsed.chain || !Array.isArray(parsed.chain)) {
      logger.error({ msg: '[taskPlanner] Missing or invalid chain' })
      return null
    }

    // 确保 strategy 有默认值
    if (!parsed.strategy) {
      parsed.strategy = {
        mode: 'sequential',
        retryPolicy: 'simple',
        timeout: 300000,
      }
    }

    // 确保 contextFlow 有默认值
    if (!parsed.contextFlow) {
      parsed.contextFlow = []
    }

    // 为每个步骤生成唯一 ID（如果没有）
    parsed.chain = parsed.chain.map((step, index) => ({
      ...step,
      id: step.id || `step-${index + 1}`,
      status: 'pending' as const,
    }))

    return parsed
  } catch (err) {
    logger.error({ msg: '[taskPlanner] Failed to parse response', error: err })
    return null
  }
}

function createSimplePlan(agent: 'editor' | 'flow' | 'page', description: string): TaskPlan {
  return {
    chain: [{
      id: 'step-1',
      agent,
      description,
      inputs: {},
      outputs: {},
      dependencies: [],
      priority: 1,
      status: 'pending',
    }],
    strategy: {
      mode: 'sequential',
      retryPolicy: 'simple',
      timeout: 300000,
    },
    contextFlow: [],
  }
}

// ────────────────────────────────────────────
// Main node function
// ────────────────────────────────────────────

export async function taskPlannerNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  const { requirement, context } = state

  logger.info({
    msg: '[taskPlanner] Planning tasks',
    hasAnalysis: !!requirement.analysis,
    source: context.source,
    status: requirement.status,
  })

  // 如果是显式模式，创建简单计划
  if (context.source !== 'standalone') {
    const agent = context.source
    const plan = createSimplePlan(
      agent,
      `生成${agent === 'editor' ? '表单' : agent === 'flow' ? '流程' : '页面'}`,
    )

    logger.info({
      msg: '[taskPlanner] Explicit mode, simple plan',
      agent,
      steps: plan.chain.length,
    })

    return {
      taskPlan: {
        plan,
        currentStepId: plan.chain[0]?.id || null,
        executionLog: [],
      },
      task: {
        ...state.task,
        type: 'planned',
        chain: plan.chain.map(step => ({
          agent: step.agent,
          description: step.description,
          status: 'pending' as const,
        })),
        currentStepIndex: 0,
      },
    }
  }

  // 如果没有需求分析，使用默认计划
  if (!requirement.analysis) {
    const plan = createSimplePlan('editor', '生成表单')

    logger.warn({ msg: '[taskPlanner] No analysis, using default plan' })

    return {
      taskPlan: {
        plan,
        currentStepId: plan.chain[0]?.id || null,
        executionLog: [],
      },
      task: {
        ...state.task,
        type: 'planned',
        chain: plan.chain.map(step => ({
          agent: step.agent,
          description: step.description,
          status: 'pending' as const,
        })),
        currentStepIndex: 0,
      },
    }
  }

  // 使用 LLM 生成详细计划
  try {
    const analysis = requirement.analysis
    const userConfirmations = requirement.userConfirmations

    // 构建上下文信息
    let contextInfo = `需求分析结果：
- 意图：${analysis.intent}
- 类型：${analysis.type}
- 复杂度：${analysis.complexity}
- 实体：${JSON.stringify(analysis.entities, null, 2)}
- 建议的任务链：${JSON.stringify(analysis.suggestedChain, null, 2)}`

    // 添加用户确认信息
    if (Object.keys(userConfirmations).length > 0) {
      contextInfo += `\n\n用户确认：
${JSON.stringify(userConfirmations, null, 2)}`
    }

    // 添加当前上下文
    if (context.currentSchema) {
      contextInfo += `\n\n当前 Schema：${JSON.stringify(context.currentSchema, null, 2).substring(0, 500)}...`
    }
    if (context.currentFlow) {
      contextInfo += `\n\n当前 Flow：${JSON.stringify(context.currentFlow, null, 2).substring(0, 500)}...`
    }

    const model = await getLLM({
      model: getModelForTask('analyze'),
      temperature: 0,
      maxTokens: 4096,
      jsonMode: true,
    })

    const stream = await model.stream([
      new SystemMessage(TASK_PLANNER_PROMPT),
      new HumanMessage(contextInfo),
    ])

    let raw = ''
    for await (const chunk of stream) {
      const content = typeof chunk.content === 'string' ? chunk.content : ''
      if (content) raw += content
    }

    const plan = parsePlanResponse(raw)

    if (!plan || plan.chain.length === 0) {
      logger.warn({ msg: '[taskPlanner] Failed to parse plan, using suggested chain' })

      // 使用建议的任务链作为 fallback
      const fallbackPlan: TaskPlan = {
        chain: analysis.suggestedChain.map((step, index) => ({
          id: `step-${index + 1}`,
          agent: step.agent,
          description: step.description,
          inputs: {},
          outputs: {},
          dependencies: step.dependencies || [],
          priority: step.priority || index + 1,
          status: 'pending' as const,
        })),
        strategy: {
          mode: 'sequential',
          retryPolicy: 'simple',
          timeout: 300000,
        },
        contextFlow: [],
      }

      return {
        taskPlan: {
          plan: fallbackPlan,
          currentStepId: fallbackPlan.chain[0]?.id || null,
          executionLog: [],
        },
        task: {
          ...state.task,
          type: 'planned',
          chain: fallbackPlan.chain.map(step => ({
            agent: step.agent,
            description: step.description,
            status: 'pending' as const,
          })),
          currentStepIndex: 0,
        },
      }
    }

    logger.info({
      msg: '[taskPlanner] Plan generated',
      steps: plan.chain.length,
      mode: plan.strategy.mode,
      dependencies: plan.contextFlow.length,
    })

    return {
      taskPlan: {
        plan,
        currentStepId: plan.chain[0]?.id || null,
        executionLog: [],
      },
      task: {
        ...state.task,
        type: 'planned',
        chain: plan.chain.map(step => ({
          agent: step.agent,
          description: step.description,
          status: 'pending' as const,
        })),
        currentStepIndex: 0,
      },
    }
  } catch (err) {
    logger.error({ msg: '[taskPlanner] LLM call failed', error: err })

    // 使用建议的任务链作为 fallback
    const fallbackPlan = createSimplePlan(
      requirement.analysis.suggestedChain[0]?.agent || 'editor',
      requirement.analysis.suggestedChain[0]?.description || '生成内容',
    )

    return {
      taskPlan: {
        plan: fallbackPlan,
        currentStepId: fallbackPlan.chain[0]?.id || null,
        executionLog: [],
      },
      task: {
        ...state.task,
        type: 'planned',
        chain: fallbackPlan.chain.map(step => ({
          agent: step.agent,
          description: step.description,
          status: 'pending' as const,
        })),
        currentStepIndex: 0,
      },
    }
  }
}

// ────────────────────────────────────────────
// Routing function
// ────────────────────────────────────────────

export function routeAfterTaskPlanner(
  state: typeof AgentStateAnnotation.State,
): string {
  const { taskPlan, thinking } = state

  // 如果没有计划，直接进入 taskChain
  if (!taskPlan.plan) {
    console.log('[routeAfterTaskPlanner] No plan -> taskChain')
    return 'taskChain'
  }

  // 如果启用了 thinker，进入 thinker 进行推理
  // 否则直接进入 taskChain
  console.log('[routeAfterTaskPlanner] -> taskChain')
  return 'taskChain'
}
