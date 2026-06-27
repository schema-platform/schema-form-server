import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export type FlowMessageStatus = 'pending' | 'consumed'

export interface IFlowMessage {
  _id: string
  tenantId: string
  channel: string
  payload: Record<string, unknown>
  senderInstanceId: string
  senderNodeId: string
  receiverInstanceId: string | null
  receiverNodeId: string | null
  status: FlowMessageStatus
  createdAt: Date
  updatedAt: Date
}

const flowMessageSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    channel: { type: String, required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    senderInstanceId: { type: String, required: true, index: true },
    senderNodeId: { type: String, required: true },
    receiverInstanceId: { type: String, default: null, index: true },
    receiverNodeId: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'consumed'],
      default: 'pending',
      index: true,
    },
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

flowMessageSchema.index({ channel: 1, status: 1, createdAt: -1 })
flowMessageSchema.index({ receiverInstanceId: 1, status: 1 })

flowMessageSchema.plugin(tenantPlugin)

export const FlowMessageModel =
  mongoose.models.FlowMessage ??
  mongoose.model<IFlowMessage>('FlowMessage', flowMessageSchema)
