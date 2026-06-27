import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IDept {
  _id: string
  tenantId: string
  name: string
  parentId: string | null
  sort: number
  status: 'active' | 'inactive'
  leader: string
  createdAt: Date
  updatedAt: Date
}

const deptSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true },
    parentId: { type: String, default: null, index: true },
    sort: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    leader: { type: String, default: '' },
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

// Compound index for tenant-scoped tree queries
deptSchema.index({ tenantId: 1, parentId: 1 })
deptSchema.index({ tenantId: 1, name: 1 })
deptSchema.index({ tenantId: 1, sort: 1 })

deptSchema.plugin(tenantPlugin)

export const DeptModel =
  mongoose.models.Dept ?? mongoose.model<IDept>('Dept', deptSchema)
