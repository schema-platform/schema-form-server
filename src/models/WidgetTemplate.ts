import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IWidgetTemplate {
  _id: string
  tenantId: string
  name: string
  description: string
  category: 'form' | 'layout' | 'table' | 'search' | 'chart' | 'business' | 'report' | 'other'
  widgetType: string
  thumbnail: string
  widgets: Record<string, unknown>[]
  tags: string[]
  isBuiltin: boolean
  createdBy: string
  usageCount: number
  createdAt: Date
  updatedAt: Date
}

const widgetTemplateSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 500 },
    category: {
      type: String,
      default: 'other',
      enum: ['form', 'layout', 'table', 'search', 'chart', 'business', 'report', 'other'],
      index: true,
    },
    widgetType: { type: String, default: '' },
    thumbnail: { type: String, default: '' },
    widgets: { type: [mongoose.Schema.Types.Mixed], required: true },
    tags: { type: [String], default: [] },
    isBuiltin: { type: Boolean, default: false, index: true },
    createdBy: { type: String, default: '' },
    usageCount: { type: Number, default: 0 },
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

widgetTemplateSchema.index({ category: 1, isBuiltin: 1 })
widgetTemplateSchema.index({ tags: 1 })
widgetTemplateSchema.index({ name: 'text', description: 'text' })

widgetTemplateSchema.plugin(tenantPlugin)

export const WidgetTemplateModel =
  mongoose.models.WidgetTemplate ?? mongoose.model<IWidgetTemplate>('WidgetTemplate', widgetTemplateSchema)
