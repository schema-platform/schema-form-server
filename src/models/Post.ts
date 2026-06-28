import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IPost {
  tenantId: string
  postCode: string
  postName: string
  sort: number
  status: 'active' | 'inactive'
  remark: string
  createdAt: Date
  updatedAt: Date
}

const postSchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: '000000', index: true },
    postCode: { type: String, required: true },
    postName: { type: String, required: true },
    sort: { type: Number, default: 0 },
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

// Compound indexes for tenant-scoped queries
postSchema.index({ tenantId: 1, postCode: 1 }, { unique: true })
postSchema.index({ tenantId: 1, postName: 1 })
postSchema.index({ tenantId: 1, sort: 1 })

postSchema.plugin(tenantPlugin)

export const PostModel =
  mongoose.models.Post ?? mongoose.model<IPost>('Post', postSchema)
