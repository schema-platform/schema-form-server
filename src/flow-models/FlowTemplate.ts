import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IFlowTemplate {
  _id: string
  tenantId: string
  name: string
  description: string
  category: string
  graph: {
    nodes: mongoose.Schema.Types.Mixed[]
    edges: mongoose.Schema.Types.Mixed[]
  }
  thumbnail: string
  tags: string[]
  isBuiltin: boolean
  useCount: number
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

const flowTemplateSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 1000 },
    category: { type: String, default: 'other', maxlength: 100 },
    graph: {
      nodes: { type: [mongoose.Schema.Types.Mixed], required: true },
      edges: { type: [mongoose.Schema.Types.Mixed], required: true },
    },
    thumbnail: { type: String, default: '' },
    tags: { type: [String], default: [] },
    isBuiltin: { type: Boolean, default: false },
    useCount: { type: Number, default: 0 },
    createdBy: { type: String, default: '' },
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

flowTemplateSchema.index({ category: 1 })
flowTemplateSchema.index({ isBuiltin: 1 })
flowTemplateSchema.index({ name: 1 })

flowTemplateSchema.plugin(tenantPlugin)

export const FlowTemplateModel =
  mongoose.models.FlowTemplate ??
  mongoose.model<IFlowTemplate>('FlowTemplate', flowTemplateSchema)
