import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IPost {
  _id: string
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
    _id: { type: String, default: uuidv4 },
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
        ret.id = ret._id
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
