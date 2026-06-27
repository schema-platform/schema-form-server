import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface ISSOSession {
  _id: string
  userId: string
  sessionToken: string
  userAgent: string
  ip: string
  expiresAt: Date
  tenantId: string
  createdAt: Date
  updatedAt: Date
}

const ssoSessionSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    userId: { type: String, required: true, index: true },
    sessionToken: { type: String, required: true, unique: true, index: true },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    expiresAt: { type: Date, required: true, index: true },
    tenantId: { type: String, default: '000000', index: true },
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

// TTL 索引：过期会话自动清理
ssoSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
// 租户内按用户查询会话
ssoSessionSchema.index({ tenantId: 1, userId: 1 })

ssoSessionSchema.plugin(tenantPlugin)

export const SSOSessionModel =
  mongoose.models.SSOSession ?? mongoose.model<ISSOSession>('SSOSession', ssoSessionSchema)
