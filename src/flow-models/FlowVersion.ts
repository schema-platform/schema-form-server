import mongoose from 'mongoose'
import type { FlowGraph, FlowGraphMetadata } from '@schema-form/flow-shared'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IFlowVersion {
  _id: string
  tenantId: string
  definitionId: string
  version: string
  graph: FlowGraph
  metadata?: FlowGraphMetadata
  createdAt: Date
  updatedAt: Date
}

const flowVersionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    definitionId: { type: String, required: true, index: true },
    version: { type: String, required: true },
    graph: {
      nodes: { type: [mongoose.Schema.Types.Mixed], required: true },
      edges: { type: [mongoose.Schema.Types.Mixed], required: true },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
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

flowVersionSchema.index({ definitionId: 1, version: -1 }, { unique: true })

flowVersionSchema.plugin(tenantPlugin)

export const FlowVersionModel =
  mongoose.models.FlowVersion ??
  mongoose.model<IFlowVersion>('FlowVersion', flowVersionSchema)
