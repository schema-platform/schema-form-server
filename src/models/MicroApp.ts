import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IMicroApp {
  tenantId: string
  name: string
  displayName: string
  url: string
  icon: string
  layout: 'with-menu' | 'without-menu'
  activeRule: string
  permissions: string[]
  status: 'active' | 'inactive'
  sort: number
  remark: string
  createdAt: Date
  updatedAt: Date
}

const microAppSchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true },
    displayName: { type: String, required: true },
    url: { type: String, required: true },
    icon: { type: String, default: '' },
    layout: { type: String, enum: ['with-menu', 'without-menu'], default: 'with-menu' },
    activeRule: { type: String, required: true },
    permissions: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    sort: { type: Number, default: 0 },
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

microAppSchema.index({ tenantId: 1, activeRule: 1 }, { unique: true })
microAppSchema.index({ tenantId: 1, status: 1 })
microAppSchema.index({ tenantId: 1, sort: 1 })

microAppSchema.plugin(tenantPlugin)

export const MicroAppModel =
  mongoose.models.MicroApp ?? mongoose.model<IMicroApp>('MicroApp', microAppSchema)
