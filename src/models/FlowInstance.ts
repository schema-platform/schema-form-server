/**
 * FlowInstance — 流程实例模型
 */
import mongoose, { Schema, type Document } from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IFlowInstance extends Document {
  id: string
  tenantId: string
  definitionId: string
  version: number
  status: 'running' | 'completed' | 'terminated' | 'suspended' | 'failed'
  variables: Record<string, unknown>
  tokens: Array<{
    tokenId: string
    nodeId: string
    parentTokenId?: string
    state: 'active' | 'waiting' | 'completed' | 'failed'
    createdAt: Date
  }>
  initiatedBy: string
  startedAt: Date
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const FlowInstanceSchema = new Schema<IFlowInstance>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, default: '000000', index: true },
    definitionId: { type: String, required: true, index: true },
    version: { type: Number, required: true },
    status: {
      type: String,
      enum: ['running', 'completed', 'terminated', 'suspended', 'failed'],
      default: 'running',
      index: true,
    },
    variables: { type: Schema.Types.Mixed, default: {} },
    tokens: [{
      tokenId: String,
      nodeId: String,
      parentTokenId: String,
      state: {
        type: String,
        enum: ['active', 'waiting', 'completed', 'failed'],
      },
      createdAt: Date,
    }],
    initiatedBy: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
  },
  {
    timestamps: true,
  },
)

FlowInstanceSchema.plugin(tenantPlugin)

export const FlowInstanceModel = mongoose.model<IFlowInstance>('FlowInstance', FlowInstanceSchema)
