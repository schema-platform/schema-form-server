import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IWebhook {
  _id: string
  name: string
  url: string
  events: string[]
  secret: string
  status: 'active' | 'inactive'
  tenantId: string
  createdBy: string
  retryPolicy: {
    maxRetries: number
    backoffMs: number
  }
  /** Associate this webhook with a flow definition for trigger mode */
  flowDefinitionId?: string
  /** HTTP method accepted by the trigger endpoint */
  method?: 'GET' | 'POST'
  /** Maps request body fields to flow variable names: { requestField: 'flowVariableName' } */
  bodyMapping?: Record<string, string>
  createdAt: Date
  updatedAt: Date
}

const retryPolicySchema = new mongoose.Schema(
  {
    maxRetries: { type: Number, default: 3, min: 0, max: 10 },
    backoffMs: { type: Number, default: 1000, min: 100, max: 60000 },
  },
  { _id: false },
)

const webhookSchemaDef = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    events: {
      type: [String],
      required: true,
      validate: {
        validator: (v: string[]) => v.length > 0,
        message: 'At least one event must be subscribed',
      },
    },
    secret: { type: String, required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    tenantId: { type: String, default: '000000', index: true },
    createdBy: { type: String, required: true, index: true },
    retryPolicy: { type: retryPolicySchema, default: () => ({}) },
    flowDefinitionId: { type: String, default: null, index: true },
    method: { type: String, enum: ['GET', 'POST'], default: 'POST' },
    bodyMapping: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        // Never expose secret in JSON output
        delete ret.secret
      },
    },
  },
)

webhookSchemaDef.plugin(tenantPlugin)

// Compound index: find active webhooks subscribed to a specific event for a tenant
webhookSchemaDef.index({ tenantId: 1, status: 1, events: 1 })

export const WebhookModel =
  mongoose.models.Webhook ?? mongoose.model<IWebhook>('Webhook', webhookSchemaDef)
