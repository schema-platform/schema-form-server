/**
 * AI Conversation State — LangGraph Annotation definition.
 *
 * Defines the shared state passed through the agent graph using
 * LangGraph's Annotation.Root() pattern. MessagesAnnotation serves
 * as the base for message handling with proper reducer semantics.
 *
 * State is organized into 5 nested groups:
 *   - session:  identifiers and active agent
 *   - task:     task chain, step tracking, intermediate results
 *   - tools:    tool calling state
 *   - error:    error handling
 *   - interaction: clarification, preferences, history summary, collaboration
 *
 * Plus two top-level fields:
 *   - messages: from MessagesAnnotation (reducer for message combining)
 *   - context:  business context (AIContext — well-structured, not flat)
 */

import { Annotation, MessagesAnnotation } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'

// ────────────────────────────────────────────
// Message types (kept for backward compatibility)
// ────────────────────────────────────────────
export type AIMessageRole = 'user' | 'assistant' | 'system'

export interface AIMessage {
  role: AIMessageRole
  content: string
  /** Agent thinking process (shown in collapsible section). */
  thinking?: string
  /** Usage tip or optimization suggestion. */
  tip?: string
  /** Tool calls made during this turn. */
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown>; result?: unknown }>
  /** Optional structured payload attached to an assistant message. */
  schema?: Record<string, unknown>[]
  flow?: Record<string, unknown>
  timestamp: Date
}

// ────────────────────────────────────────────
// Context
// ────────────────────────────────────────────
export type AgentSource = 'editor' | 'flow' | 'page' | 'standalone'
export type ActiveAgent = 'router' | 'editor' | 'flow' | 'page' | 'general'

/** Task chain step */
export interface TaskStep {
  agent: 'editor' | 'flow' | 'page'
  description: string
  status: 'pending' | 'running' | 'done' | 'skipped'
  result?: Record<string, unknown>
  /** Collaboration context passed from the requesting agent. */
  context?: Record<string, unknown>
}

export interface AIContext {
  source: AgentSource
  schemaId?: string
  flowId?: string
  nodeId?: string
  /** Current Widget tree in the editor, provided by the frontend for reference. */
  currentSchema?: Record<string, unknown>[]
  /** Current flow graph, provided for flow conversations. */
  currentFlow?: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }
  /** @ referenced resource content */
  mentionedResources?: Array<{ type: 'schema' | 'flow'; name: string; content: Record<string, unknown> | Record<string, unknown>[] }>
  /** Currently selected widget in the editor. */
  selectedWidget?: { id: string; type: string; field?: string; label?: string }
  /** Current editor mode. */
  editorMode?: 'edit' | 'preview'
  /** Running count of user turns in this conversation. */
  turnCount: number
}

// ────────────────────────────────────────────
// Error state
// ────────────────────────────────────────────
export interface AIError {
  message: string
  recoverable: boolean
}

// ────────────────────────────────────────────
// Router and Tool types
// ────────────────────────────────────────────
export interface RouterDecision {
  target: ActiveAgent
  confidence: number
  reasoning?: string
}

export interface AgentToolResult {
  name: string
  arguments: Record<string, unknown>
  result: unknown
  error?: string
  duration?: number
}

// ────────────────────────────────────────────
// Collaboration request type
// ────────────────────────────────────────────
export interface CollaborationRequest {
  targetAgent: 'editor' | 'flow' | 'page'
  description: string
  context?: Record<string, unknown>
  conversationId?: string
}

// ────────────────────────────────────────────
// v2: Requirement Analysis types
// ────────────────────────────────────────────

export interface RequirementEntity {
  name: string
  purpose?: string
  fields?: Array<{ name: string; type: string; required: boolean }>
  nodes?: Array<{ type: string; name: string; assignee?: string }>
  conditions?: Array<{ from: string; to: string; condition: string }>
  type?: 'list' | 'detail' | 'dashboard'
  components?: string[]
}

export interface RequirementAnalysis {
  intent: 'create' | 'modify' | 'query' | 'help'
  type: 'form' | 'flow' | 'page' | 'mixed' | 'general'
  complexity: 'simple' | 'medium' | 'complex'
  entities: {
    forms?: RequirementEntity[]
    flows?: RequirementEntity[]
    pages?: RequirementEntity[]
  }
  completeness: {
    score: number
    missing: string[]
    assumptions: string[]
  }
  confirmQuestions: Array<{
    id: string
    question: string
    options?: string[]
    required: boolean
  }>
  suggestedChain: Array<{
    agent: 'editor' | 'flow' | 'page'
    description: string
    priority: number
    dependencies: string[]
  }>
}

export interface TaskPlanStep {
  id: string
  agent: 'editor' | 'flow' | 'page'
  description: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  dependencies: string[]
  priority: number
  status: 'pending' | 'running' | 'done' | 'error'
}

export interface TaskPlan {
  chain: TaskPlanStep[]
  strategy: {
    mode: 'sequential' | 'parallel' | 'mixed'
    retryPolicy: 'none' | 'simple' | 'exponential'
    timeout: number
  }
  contextFlow: Array<{
    from: string
    to: string
    data: string[]
  }>
}

export interface ThinkerOutput {
  adjustments: {
    skipSteps?: string[]
    addSteps?: TaskPlanStep[]
    reorderSteps?: string[]
    changeAgent?: { stepId: string; newAgent: string }
  }
  risks: Array<{
    type: 'complexity' | 'ambiguity' | 'dependency'
    description: string
    mitigation: string
  }>
  suggestions: Array<{
    type: 'optimize' | 'simplify' | 'split'
    description: string
    impact: 'low' | 'medium' | 'high'
  }>
}

export interface QualityCheckResult {
  structure: {
    valid: boolean
    errors: string[]
    warnings: string[]
  }
  completeness: {
    score: number
    missing: string[]
  }
  consistency: {
    score: number
    conflicts: string[]
  }
  suggestions: Array<{
    type: 'fix' | 'improve' | 'add'
    description: string
    priority: 'low' | 'medium' | 'high'
  }>
  needsRetry: boolean
  retryReason?: string
}

// ────────────────────────────────────────────
// LangGraph State Annotation (nested structure)
// ────────────────────────────────────────────

/**
 * Full AI conversation state using LangGraph's Annotation.Root().
 *
 * MessagesAnnotation provides the `messages` field with proper
 * message combining semantics (handles BaseMessage, RemoveMessage, etc.).
 *
 * All custom fields use "replace" semantics (last write wins).
 */
export const AgentStateAnnotation = Annotation.Root({
  // Inherit messages from MessagesAnnotation (includes reducer for message combining)
  ...MessagesAnnotation.spec,

  // Business context (schema, flow, source info) — well-structured, stays top-level
  context: Annotation<AIContext>({
    reducer: (_, next) => next,
    default: () => ({ source: 'standalone' as AgentSource, turnCount: 0 }),
  }),

  // ── Group 1: Session ──
  session: Annotation<{
    id: string
    conversationId: string
    currentAgent: ActiveAgent
  }>({
    reducer: (_, next) => next,
    default: () => ({ id: '', conversationId: '', currentAgent: 'router' as ActiveAgent }),
  }),

  // ── Group 2: Task ──
  task: Annotation<{
    type: string
    chain: TaskStep[]
    currentStepIndex: number
    intermediateResults: Record<string, unknown>[]
    currentVersion: number
  }>({
    reducer: (_, next) => next,
    default: () => ({ type: 'general', chain: [], currentStepIndex: 0, intermediateResults: [], currentVersion: 0 }),
  }),

  // ── Group 3: Tools ──
  tools: Annotation<{
    needsTool: boolean
    results: AgentToolResult[]
    toolIterationCount: number
  }>({
    reducer: (_, next) => next,
    default: () => ({ needsTool: false, results: [], toolIterationCount: 0 }),
  }),

  // ── Group 4: Error ──
  error: Annotation<AIError | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // ── Group 5: Interaction ──
  interaction: Annotation<{
    clarificationRequest: string | null
    clarificationOptions: string[]
    preferences: Record<string, unknown>
    historySummary: string
    collaborationRequest: CollaborationRequest | null
    collaborationHistory: Array<{ from: string; to: string; timestamp: number }>
  }>({
    reducer: (_, next) => next,
    default: () => ({
      clarificationRequest: null,
      clarificationOptions: [],
      preferences: {},
      historySummary: '',
      collaborationRequest: null,
      collaborationHistory: [],
    }),
  }),

  // ── Group 6: Requirement Analysis (v2) ──
  requirement: Annotation<{
    analysis: RequirementAnalysis | null
    userConfirmations: Record<string, string>
    needsConfirmation: boolean
    status: 'pending' | 'analyzed' | 'confirmed' | 'rejected'
  }>({
    reducer: (_, next) => next,
    default: () => ({
      analysis: null,
      userConfirmations: {},
      needsConfirmation: false,
      status: 'pending' as const,
    }),
  }),

  // ── Group 7: Task Plan (v2) ──
  taskPlan: Annotation<{
    plan: TaskPlan | null
    currentStepId: string | null
    executionLog: Array<{
      stepId: string
      startTime: Date
      endTime?: Date
      status: 'running' | 'done' | 'error'
      result?: unknown
    }>
  }>({
    reducer: (_, next) => next,
    default: () => ({
      plan: null,
      currentStepId: null,
      executionLog: [],
    }),
  }),

  // ── Group 8: Thinking (v2) ──
  thinking: Annotation<{
    lastThinkTime: Date | null
    adjustments: ThinkerOutput['adjustments']
    risks: ThinkerOutput['risks']
  }>({
    reducer: (_, next) => next,
    default: () => ({
      lastThinkTime: null,
      adjustments: {},
      risks: [],
    }),
  }),

  // ── Group 9: Quality Check (v2) ──
  quality: Annotation<{
    lastCheckTime: Date | null
    result: QualityCheckResult | null
    retryCount: number
  }>({
    reducer: (_, next) => next,
    default: () => ({
      lastCheckTime: null,
      result: null,
      retryCount: 0,
    }),
  }),
})

// ────────────────────────────────────────────
// Type aliases
// ────────────────────────────────────────────

/** Full state type for the AI conversation graph. */
export type AIConversationState = typeof AgentStateAnnotation.State

/** State type for Editor Agent subgraph. */
export type EditorAgentState = typeof AgentStateAnnotation.State

/** Update type for partial state updates from nodes. */
export type AgentStateUpdate = typeof AgentStateAnnotation.Update
