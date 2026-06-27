/**
 * AI Conversation persistence service.
 *
 * Manages the `AIConversation` MongoDB collection for long-term memory.
 * Supports CRUD, message append, and active agent tracking.
 */

import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AIMessage, ActiveAgent, AgentSource } from '../graph/state.js'

// ────────────────────────────────────────────
// Summary generation config
// ────────────────────────────────────────────

/** Generate summary when conversation exceeds this many messages. */
const SUMMARY_THRESHOLD = 20

/** Keep this many recent messages in full when generating summary. */
const KEEP_RECENT_COUNT = 6

const SUMMARY_SYSTEM_PROMPT = `你是一个对话摘要助手。请将以下多轮对话压缩为一段简洁的摘要。

摘要要求：
1. 保留用户的原始意图和核心需求
2. 记录关键决策（选择了什么组件、布局方式、流程结构）
3. 记录已生成的 Schema/Flow 的关键信息（类型、主要结构）
4. 记录用户明确的偏好或约束
5. 不要丢失任何对后续对话有影响的重要上下文

输出一段连贯的中文摘要文本，不超过 500 字。不要输出格式化的列表，用流畅的段落描述。`

// ────────────────────────────────────────────
// Mongoose model
// ────────────────────────────────────────────

interface AIConversationMessage {
  _id?: string
  role: AIMessage['role']
  content: string
  thinking?: string
  tip?: string
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown>; result?: unknown }>
  schema?: Record<string, unknown>[]
  flow?: Record<string, unknown>
  timestamp: Date
  feedback?: 'positive' | 'negative' | null
  feedbackComment?: string
}

export interface IAIConversation {
  _id: string
  source: AgentSource
  schemaId?: string
  flowId?: string
  nodeId?: string
  version?: string
  messages: AIConversationMessage[]
  activeAgent: ActiveAgent
  /** 对话历史摘要（当消息数超过阈值时自动生成） */
  historySummary?: string
  createdAt: Date
  updatedAt: Date
}

const messageSchema = new mongoose.Schema<AIConversationMessage>(
  {
    _id: { type: String, default: () => uuidv4() },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    thinking: { type: String },
    tip: { type: String },
    toolCalls: [{
      name: { type: String, required: true },
      arguments: { type: mongoose.Schema.Types.Mixed, default: {} },
      result: { type: mongoose.Schema.Types.Mixed },
    }],
    schema: { type: mongoose.Schema.Types.Mixed },
    flow: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now },
    feedback: { type: String, enum: ['positive', 'negative', null], default: null },
    feedbackComment: { type: String },
  },
  { _id: true },
)

const aiConversationSchema = new mongoose.Schema<IAIConversation>(
  {
    _id: { type: String, required: true },
    source: { type: String, enum: ['editor', 'flow', 'page', 'standalone'], required: true },
    schemaId: { type: String },
    flowId: { type: String },
    nodeId: { type: String },
    version: { type: String },
    messages: { type: [messageSchema], default: [] },
    activeAgent: { type: String, enum: ['router', 'editor', 'flow', 'page', 'general'], default: 'router' },
    historySummary: { type: String },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
      },
    },
  },
)

aiConversationSchema.index({ updatedAt: -1 })

export const AIConversationModel =
  mongoose.models.AIConversation ??
  mongoose.model<IAIConversation>('AIConversation', aiConversationSchema)

// ────────────────────────────────────────────
// Service functions
// ────────────────────────────────────────────

/**
 * Create a new conversation.
 */
export async function createConversation(params: {
  source: AgentSource
  schemaId?: string
  flowId?: string
  nodeId?: string
  version?: string
}): Promise<IAIConversation> {
  return AIConversationModel.create({
    _id: uuidv4(),
    source: params.source,
    schemaId: params.schemaId,
    flowId: params.flowId,
    nodeId: params.nodeId,
    version: params.version,
    messages: [],
    activeAgent: 'router',
  })
}

/**
 * Get a conversation by ID.
 */
export async function getConversation(id: string): Promise<IAIConversation | null> {
  return AIConversationModel.findById(id)
}

/**
 * Append a message to an existing conversation.
 */
export async function appendMessage(
  conversationId: string,
  message: AIMessage,
): Promise<IAIConversation | null> {
  return AIConversationModel.findByIdAndUpdate(
    conversationId,
    {
      $push: {
        messages: {
          role: message.role,
          content: message.content,
          thinking: message.thinking,
          tip: message.tip,
          toolCalls: message.toolCalls,
          schema: message.schema,
          flow: message.flow,
          timestamp: message.timestamp,
        },
      },
    },
    { new: true },
  )
}

/**
 * Update the active agent for a conversation.
 */
export async function updateActiveAgent(
  conversationId: string,
  agent: ActiveAgent,
): Promise<void> {
  await AIConversationModel.findByIdAndUpdate(conversationId, {
    $set: { activeAgent: agent },
  })
}

/**
 * List all conversations (most recently updated first).
 */
export async function listConversations(): Promise<IAIConversation[]> {
  return AIConversationModel.find().sort({ updatedAt: -1 }).limit(50)
}

/**
 * Delete a conversation by ID.
 */
export async function deleteConversation(id: string): Promise<boolean> {
  const result = await AIConversationModel.findByIdAndDelete(id)
  return result !== null
}

/**
 * Update feedback for a specific message in a conversation.
 */
export async function updateMessageFeedback(
  conversationId: string,
  messageId: string,
  feedback: 'positive' | 'negative',
  comment?: string,
): Promise<boolean> {
  const result = await AIConversationModel.updateOne(
    { _id: conversationId, 'messages._id': messageId },
    {
      $set: {
        'messages.$.feedback': feedback,
        'messages.$.feedbackComment': comment,
      },
    },
  )
  return result.modifiedCount > 0
}

/**
 * Get messages for a conversation (for restoring context).
 */
export async function getMessages(conversationId: string): Promise<AIMessage[]> {
  const convo = await AIConversationModel.findById(conversationId).select('messages')
  if (!convo) return []
  return convo.messages.map((m: AIConversationMessage) => ({
    role: m.role,
    content: m.content,
    thinking: m.thinking,
    tip: m.tip,
    toolCalls: m.toolCalls,
    schema: m.schema,
    flow: m.flow,
    timestamp: m.timestamp,
  }))
}

/**
 * Search and filter conversations with pagination.
 */
export async function searchConversations(params: {
  keyword?: string
  startDate?: string
  endDate?: string
  source?: string
  page: number
  pageSize: number
}): Promise<{ conversations: IAIConversation[]; total: number; page: number; pageSize: number }> {
  const filter: Record<string, unknown> = {}

  if (params.keyword) {
    filter['messages.content'] = { $regex: params.keyword, $options: 'i' }
  }
  if (params.source) {
    filter.source = params.source
  }
  if (params.startDate || params.endDate) {
    const createdAt: Record<string, Date> = {}
    if (params.startDate) createdAt.$gte = new Date(params.startDate)
    if (params.endDate) createdAt.$lte = new Date(params.endDate)
    filter.createdAt = createdAt
  }

  const skip = (params.page - 1) * params.pageSize

  const [conversations, total] = await Promise.all([
    AIConversationModel.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(params.pageSize),
    AIConversationModel.countDocuments(filter),
  ])

  return { conversations, total, page: params.page, pageSize: params.pageSize }
}

// ────────────────────────────────────────────
// History summary management
// ────────────────────────────────────────────

/**
 * Save a generated history summary to the conversation.
 */
export async function saveHistorySummary(
  conversationId: string,
  summary: string,
): Promise<void> {
  await AIConversationModel.findByIdAndUpdate(conversationId, {
    $set: { historySummary: summary },
  })
}

/**
 * Format messages into a transcript for the summarization LLM call.
 *
 * Includes structured schema/flow metadata so the summary captures
 * what was generated (widget types, field names, node counts).
 */
function formatMessagesForSummary(messages: AIConversationMessage[]): string {
  return messages
    .map((m) => {
      const role = m.role === 'user' ? '用户' : '助手'
      let line = `[${role}] ${m.content}`
      if (m.toolCalls && m.toolCalls.length > 0) {
        const toolNames = m.toolCalls.map((tc) => tc.name).join(', ')
        line += ` (调用了工具: ${toolNames})`
      }
      if (m.schema && Array.isArray(m.schema)) {
        const widgetTypes = extractWidgetTypeSummary(m.schema)
        const fieldNames = extractFieldNames(m.schema)
        line += ` (生成了 Schema: ${m.schema.length} 个组件 [${widgetTypes}])`
        if (fieldNames.length > 0) {
          line += `, 字段: ${fieldNames.slice(0, 8).join(', ')}${fieldNames.length > 8 ? '...' : ''}`
        }
      }
      if (m.flow && typeof m.flow === 'object') {
        const nodes = (m.flow as Record<string, unknown>).nodes as Array<Record<string, unknown>> | undefined
        const edges = (m.flow as Record<string, unknown>).edges as Array<Record<string, unknown>> | undefined
        if (nodes) {
          const nodeTypes = Array.from(new Set(nodes.map((n) => {
            const data = n.data as Record<string, unknown> | undefined
            return (data?.bpmnType as string) ?? (n.type as string) ?? 'unknown'
          }))).join(', ')
          line += ` (生成了 Flow: ${nodes.length} 个节点, ${(edges ?? []).length} 条连线 [${nodeTypes}])`
        }
      }
      return line
    })
    .join('\n')
}

/**
 * Extract unique widget types from a schema tree (recursive).
 */
function extractWidgetTypeSummary(widgets: Record<string, unknown>[]): string {
  const types: string[] = []
  const collect = (w: Record<string, unknown>) => {
    if (w.type) types.push(w.type as string)
    const children = w.children as Record<string, unknown>[] | undefined
    if (children) children.forEach(collect)
  }
  widgets.forEach(collect)
  return Array.from(new Set(types)).join(', ')
}

/**
 * Extract field names from a schema tree (recursive).
 */
function extractFieldNames(widgets: Record<string, unknown>[]): string[] {
  const fields: string[] = []
  const collect = (w: Record<string, unknown>) => {
    if (w.field) fields.push(w.field as string)
    const children = w.children as Record<string, unknown>[] | undefined
    if (children) children.forEach(collect)
  }
  widgets.forEach(collect)
  return Array.from(new Set(fields))
}

/**
 * Generate a history summary using LLM for the given messages.
 *
 * Returns the summary string, or null if the LLM call fails.
 */
async function generateSummaryFromMessages(
  messages: AIConversationMessage[],
): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return null

  const transcript = formatMessagesForSummary(messages)

  try {
    const model = new ChatOpenAI({
      model: 'deepseek-v4-pro',
      apiKey,
      configuration: { baseURL: 'https://api.deepseek.com' },
      temperature: 0.3,
      maxTokens: 1024,
    })

    const response = await model.invoke([
      new SystemMessage(SUMMARY_SYSTEM_PROMPT),
      new HumanMessage(transcript),
    ])

    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content)

    return content.trim() || null
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.warn(`[historySummary] 摘要生成失败: ${errorMessage}`)
    return null
  }
}

/**
 * Check if a conversation needs summarization and generate it.
 *
 * Called after each assistant message is persisted. When the message count
 * exceeds `SUMMARY_THRESHOLD`, the older messages (everything except the
 * last `KEEP_RECENT_COUNT`) are summarized via LLM and stored on the
 * conversation document.
 *
 * This is non-destructive: the full messages array remains in MongoDB
 * for display purposes. The summary only provides compressed context
 * for the LLM graph.
 */
export async function maybeGenerateSummary(
  conversationId: string,
): Promise<string | undefined> {
  const convo = await AIConversationModel.findById(conversationId).select('messages historySummary')
  if (!convo) return undefined

  const { messages } = convo
  if (messages.length < SUMMARY_THRESHOLD) return convo.historySummary ?? undefined

  // Only re-generate if we don't already have a summary or if messages
  // have grown significantly since the last summary (threshold * 1.5)
  if (convo.historySummary && messages.length < SUMMARY_THRESHOLD * 1.5) {
    return convo.historySummary
  }

  // Summarize all messages except the most recent KEEP_RECENT_COUNT
  const messagesToSummarize = messages.slice(0, messages.length - KEEP_RECENT_COUNT)
  const summary = await generateSummaryFromMessages(messagesToSummarize)

  if (summary) {
    await saveHistorySummary(conversationId, summary)
    return summary
  }

  return convo.historySummary ?? undefined
}
