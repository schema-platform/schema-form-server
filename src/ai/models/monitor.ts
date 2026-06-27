/**
 * Agent Performance Monitoring Model.
 *
 * Records metrics for each agent operation:
 * - Response time (duration in ms)
 * - Success/failure rate
 * - Token usage (prompt, completion, total)
 * - Error details for failed operations
 */

import mongoose from 'mongoose'
import { tenantPlugin } from '../../middleware/tenantPlugin.js'

// ────────────────────────────────────────────
// Interfaces
// ────────────────────────────────────────────

export interface ITokenUsage {
  prompt?: number
  completion?: number
  total?: number
}

export interface IAgentMetric {
  _id: string
  tenantId: string
  agentName: string
  operation: string
  duration: number
  success: boolean
  error?: string
  tokenUsage?: ITokenUsage
  metadata?: Record<string, unknown>
  createdAt: Date
}

// ────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────

const tokenUsageSchema = new mongoose.Schema(
  {
    prompt: { type: Number },
    completion: { type: Number },
    total: { type: Number },
  },
  { _id: false },
)

const agentMetricSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    agentName: {
      type: String,
      required: true,
      index: true,
      enum: ['thinker', 'editor', 'flow', 'general', 'summarizer', 'router'],
    },
    operation: {
      type: String,
      required: true,
      index: true,
      enum: ['invoke', 'tool_call', 'think', 'stream'],
    },
    duration: { type: Number, required: true, min: 0 },
    success: { type: Boolean, required: true, index: true },
    error: { type: String },
    tokenUsage: { type: tokenUsageSchema },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
      },
    },
  },
)

// Compound indexes for common queries
agentMetricSchema.index({ agentName: 1, createdAt: -1 })
agentMetricSchema.index({ success: 1, createdAt: -1 })
agentMetricSchema.index({ createdAt: -1 })

agentMetricSchema.plugin(tenantPlugin)

// ────────────────────────────────────────────
// Model
// ────────────────────────────────────────────

export const AgentMetricModel =
  mongoose.models.AgentMetric ?? mongoose.model<IAgentMetric>('AgentMetric', agentMetricSchema)
