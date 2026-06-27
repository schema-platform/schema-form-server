import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IConfig {
  _id: string
  tenantId: string
  name: string
  key: string
  value: string
  type: 'system' | 'business'
  status: 'active' | 'inactive'
  remark: string
  createdAt: Date
  updatedAt: Date
}

const configSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true },
    key: { type: String, required: true },
    value: { type: String, default: '' },
    type: { type: String, enum: ['system', 'business'], default: 'business' },
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

configSchema.index({ tenantId: 1, key: 1 }, { unique: true })
configSchema.index({ tenantId: 1, name: 1 })
configSchema.index({ tenantId: 1, type: 1 })
configSchema.index({ tenantId: 1, status: 1 })

configSchema.plugin(tenantPlugin)

export const ConfigModel =
  mongoose.models.Config ?? mongoose.model<IConfig>('Config', configSchema)
