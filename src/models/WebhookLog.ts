import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IWebhookLog {
  _id: string
  webhookId: string
  event: string
  status: 'success' | 'failed'
  statusCode: number
  requestBody: Record<string, unknown>
  responseBody: string
  retryCount: number
  tenantId: string
  createdAt: Date
  updatedAt: Date
}

const webhookLogSchemaDef = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    webhookId: { type: String, required: true, index: true },
    event: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['success', 'failed'],
      required: true,
      index: true,
    },
    statusCode: { type: Number, required: true },
    requestBody: { type: mongoose.Schema.Types.Mixed, required: true },
    responseBody: { type: String, default: '' },
    retryCount: { type: Number, default: 0 },
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

webhookLogSchemaDef.plugin(tenantPlugin)

// Compound indexes for common queries
webhookLogSchemaDef.index({ webhookId: 1, createdAt: -1 })
webhookLogSchemaDef.index({ tenantId: 1, event: 1, createdAt: -1 })

export const WebhookLogModel =
  mongoose.models.WebhookLog ?? mongoose.model<IWebhookLog>('WebhookLog', webhookLogSchemaDef)
