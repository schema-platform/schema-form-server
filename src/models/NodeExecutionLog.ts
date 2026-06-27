import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export type NodeExecutionStatus = 'running' | 'completed' | 'failed' | 'skipped'

export interface INodeExecutionLog {
  _id: string
  tenantId: string
  instanceId: string
  nodeId: string
  nodeName: string
  status: NodeExecutionStatus
  input: Record<string, unknown>
  output: Record<string, unknown>
  error: string
  startedAt: Date
  completedAt: Date | null
  duration: number
  createdAt: Date
  updatedAt: Date
}

const nodeExecutionLogSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    tenantId: { type: String, default: '000000', index: true },
    instanceId: { type: String, required: true, index: true },
    nodeId: { type: String, required: true },
    nodeName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed', 'skipped'],
      default: 'running',
    },
    input: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    output: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    error: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    duration: { type: Number, default: 0 },
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

// Composite index: query logs by instance, ordered by start time
nodeExecutionLogSchema.index({ instanceId: 1, startedAt: 1 })

// Composite index: per-node performance analysis
nodeExecutionLogSchema.index({ instanceId: 1, nodeId: 1 })

// TTL index: auto-delete logs after 30 days
nodeExecutionLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })

nodeExecutionLogSchema.plugin(tenantPlugin)

export const NodeExecutionLogModel =
  mongoose.models.NodeExecutionLog ??
  mongoose.model<INodeExecutionLog>('NodeExecutionLog', nodeExecutionLogSchema)
