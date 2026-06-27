import mongoose from 'mongoose'
import type { FlowInstanceStatus, FlowToken } from '@schema-form/flow-shared'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IFlowInstance {
  _id: string
  tenantId: string
  definitionId: string
  versionId: string
  version: string
  status: FlowInstanceStatus
  variables: Record<string, unknown>
  tokens: FlowToken[]
  initiatedBy: string
  parentInstanceId: string | null
  parentTokenId: string | null
  startedAt: Date
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const flowTokenSchema = new mongoose.Schema(
  {
    tokenId: { type: String, required: true },
    nodeId: { type: String, required: true },
    parentTokenId: { type: String, default: null },
    state: {
      type: String,
      enum: ['active', 'waiting', 'completed'],
      default: 'active',
    },
    createdAt: { type: Date, default: Date.now },
    waitingSince: { type: Date, default: null },
  },
  { _id: false },
)

const flowInstanceSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    definitionId: { type: String, required: true, index: true },
    versionId: { type: String, required: true },
    version: { type: String, required: true },
    status: {
      type: String,
      enum: ['running', 'completed', 'terminated', 'suspended', 'failed'],
      default: 'running',
    },
    variables: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    tokens: { type: [flowTokenSchema], default: [] },
    initiatedBy: { type: String, required: true },
    parentInstanceId: { type: String, default: null, index: true },
    parentTokenId: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
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

flowInstanceSchema.index({ status: 1, updatedAt: -1 })

flowInstanceSchema.plugin(tenantPlugin)

export const FlowInstanceModel =
  mongoose.models.FlowInstance ??
  mongoose.model<IFlowInstance>('FlowInstance', flowInstanceSchema)
