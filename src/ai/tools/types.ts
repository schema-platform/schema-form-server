/**
 * Shared type definitions for AI tools.
 *
 * ToolResult is the canonical return shape for all LangGraph tools.
 * Per LangChain best practice, tools must return string (or ToolMessage),
 * so each tool handler calls JSON.stringify on a ToolResult before returning.
 */

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
  /** Natural language summary — LLM can quote directly */
  summary?: string
}
