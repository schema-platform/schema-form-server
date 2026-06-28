import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IDictType {
  tenantId: string
  name: string
  code: string
  status: 'active' | 'inactive'
  remark: string
  createdAt: Date
  updatedAt: Date
}

const dictTypeSchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    remark: { type: String, default: '' },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
      },
    },
  },
)

dictTypeSchema.index({ tenantId: 1, code: 1 }, { unique: true })
dictTypeSchema.index({ tenantId: 1, name: 1 })
dictTypeSchema.index({ tenantId: 1, status: 1 })

dictTypeSchema.plugin(tenantPlugin)

export const DictTypeModel =
  mongoose.models.DictType ?? mongoose.model<IDictType>('DictType', dictTypeSchema)
