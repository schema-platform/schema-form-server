import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface ISSOSession {
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
    userId: { type: String, required: true, index: true },
    sessionToken: { type: String, required: true, unique: true },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
    tenantId: { type: String, default: '000000', index: true },
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

// TTL 索引：过期会话自动清理
ssoSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
// 租户内按用户查询会话
ssoSessionSchema.index({ tenantId: 1, userId: 1 })

ssoSessionSchema.plugin(tenantPlugin)

export const SSOSessionModel =
  mongoose.models.SSOSession ?? mongoose.model<ISSOSession>('SSOSession', ssoSessionSchema)
