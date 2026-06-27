import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IDictData {
  _id: string
  tenantId: string
  dictTypeId: string
  label: string
  value: string
  sort: number
  status: 'active' | 'inactive'
  remark: string
  createdAt: Date
  updatedAt: Date
}

const dictDataSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    tenantId: { type: String, default: '000000', index: true },
    dictTypeId: { type: String, required: true, index: true },
    label: { type: String, required: true },
    value: { type: String, required: true },
    sort: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    remark: { type: String, default: '' },
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

dictDataSchema.index({ tenantId: 1, dictTypeId: 1, value: 1 }, { unique: true })
dictDataSchema.index({ tenantId: 1, dictTypeId: 1, sort: 1 })
dictDataSchema.index({ tenantId: 1, dictTypeId: 1, status: 1 })

dictDataSchema.plugin(tenantPlugin)

export const DictDataModel =
  mongoose.models.DictData ?? mongoose.model<IDictData>('DictData', dictDataSchema)
