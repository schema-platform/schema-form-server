/**
 * FlowDefinition — 流程定义模型
 */
import mongoose, { Schema, type Document } from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IFlowDefinition extends Document {
  id: string
  tenantId: string
  name: string
  description?: string
  graph: {
    nodes: Array<{
      id: string
      shape: string
      x: number
      y: number
      width: number
      height: number
      data: Record<string, unknown>
    }>
    edges: Array<{
      id: string
      shape: string
      source: { cell: string; port?: string }
      target: { cell: string; port?: string }
      data: Record<string, unknown>
    }>
  }
  version: number
  status: 'draft' | 'published'
  createdAt: Date
  updatedAt: Date
}

const FlowDefinitionSchema = new Schema<IFlowDefinition>(
  {
    id: { type: String, required: true, unique: true },
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true },
    description: { type: String },
    graph: {
      nodes: [{
        id: String,
        shape: String,
        x: Number,
        y: Number,
        width: Number,
        height: Number,
        data: Schema.Types.Mixed,
      }],
      edges: [{
        id: String,
        shape: String,
        source: { cell: String, port: String },
        target: { cell: String, port: String },
        data: Schema.Types.Mixed,
      }],
    },
    version: { type: Number, default: 1 },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  },
  {
    timestamps: true,
  },
)

FlowDefinitionSchema.plugin(tenantPlugin)

export const FlowDefinitionModel = mongoose.model<IFlowDefinition>('FlowDefinition', FlowDefinitionSchema)
