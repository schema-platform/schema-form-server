/**
 * AI Agent Graph — exports.
 *
 * Re-exports the compiled graph, node functions, state types,
 * and shared utilities still used by tools and schemaGenerator.
 */

// Compiled graph (primary entry point)
export { graph, routeAfterRouter, routeAfterTaskChain, afterAgent, afterToolsRoute } from './graph.js'

// Checkpointer (for thread-based conversation persistence)
export { checkpointer } from './checkpointer.js'

// State definition
export { AgentStateAnnotation } from './state.js'
export type { AIConversationState, AgentStateUpdate, ActiveAgent, TaskStep, AIContext } from './state.js'

// Nodes
export { editorAgentNode } from './editorAgent.js'
export { flowAgentNode } from './flowAgent.js'

// Shared utilities (used by tools and schemaGenerator)
export {
  getClient,
  getModelForTask,
  escapeRegex,
} from './agentBase.js'
export type { TaskType } from './agentBase.js'
