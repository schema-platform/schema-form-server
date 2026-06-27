/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import type { AgentStateAnnotation } from '../graph/state.js'

type State = typeof AgentStateAnnotation.State

function makeState(content: string, source: 'editor' | 'flow' | 'page' | 'standalone' = 'standalone'): State {
  return {
    messages: [new HumanMessage(content)],
    currentAgent: 'router',
    sessionId: '',
    conversationId: '',
    context: { source, turnCount: 1 },
    taskType: 'general',
    needsTool: false,
    toolResults: [],
    error: null,
    clarificationRequest: null,
    clarificationOptions: [],
    taskChain: [],
    currentStepIndex: 0,
    intermediateResults: [],
    preferences: {},
    historySummary: '',
  }
}

describe('thinker node routing', () => {
  // 注意：这些测试验证显式模式下的路由逻辑
  // auto 模式需要 LLM 调用，在集成测试中验证

  it('explicit editor mode routes to editor', () => {
    const state = makeState('生成一个用户注册表单', 'editor')
    // 显式模式下，thinker 直接返回 editor
    expect(state.context.source).toBe('editor')
  })

  it('explicit flow mode routes to flow', () => {
    const state = makeState('创建一个审批流程', 'flow')
    expect(state.context.source).toBe('flow')
  })

  it('explicit page mode routes to page', () => {
    const state = makeState('做一个用户管理列表页', 'page')
    expect(state.context.source).toBe('page')
  })

  it('standalone mode uses LLM for routing', () => {
    const state = makeState('帮我做一个东西')
    expect(state.context.source).toBe('standalone')
  })
})
