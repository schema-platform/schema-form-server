/**
 * AI 生成物版本模型
 *
 * 记录每次 AI 生成的 schema/flow 产物版本。
 * 支持版本列表查询、版本恢复、版本对比。
 */

import mongoose from 'mongoose'
import { tenantPlugin } from '../../middleware/tenantPlugin.js'

export interface IAIVersion {
  _id: string
  tenantId: string
  conversationId: string
  messageId: string
  type: 'schema' | 'flow'
  content: Record<string, unknown>[] | Record<string, unknown>
  version: number
  description?: string
  createdAt: Date
}

const aiVersionSchema = new mongoose.Schema<IAIVersion>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    conversationId: { type: String, required: true },
    messageId: { type: String, required: true },
    type: { type: String, enum: ['schema', 'flow'], required: true },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    version: { type: Number, required: true },
    description: { type: String },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
      },
    },
  },
)

aiVersionSchema.index({ conversationId: 1, version: -1 })
aiVersionSchema.index({ conversationId: 1, type: 1 })

aiVersionSchema.plugin(tenantPlugin)

export const AIVersionModel =
  mongoose.models.AIVersion ??
  mongoose.model<IAIVersion>('AIVersion', aiVersionSchema)
