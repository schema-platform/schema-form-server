import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IFlowDefinition {
  _id: string
  tenantId: string
  name: string
  description?: string
  category?: string
  status: 'draft' | 'published' | 'archived'
  currentVersionId?: string
  thumbnail?: string
  createdBy: string
  permissions: {
    editors: string[]
    launchers: string[]
    viewers: string[]
  }
  createdAt: Date
  updatedAt: Date
}

const flowDefinitionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    category: { type: String, default: '' },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
    },
    currentVersionId: { type: String, default: null },
    thumbnail: { type: String, default: '' },
    createdBy: { type: String, required: true },
    permissions: {
      editors: { type: [String], default: [] },
      launchers: { type: [String], default: [] },
      viewers: { type: [String], default: [] },
    },
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

flowDefinitionSchema.index({ name: 1 })
flowDefinitionSchema.index({ status: 1 })
flowDefinitionSchema.index({ createdBy: 1 })

flowDefinitionSchema.plugin(tenantPlugin)

export const FlowDefinitionModel =
  mongoose.models.FlowDefinition ??
  mongoose.model<IFlowDefinition>('FlowDefinition', flowDefinitionSchema)
