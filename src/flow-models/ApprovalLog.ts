import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

interface IApprovalLog {
  _id: string
  tenantId: string
  instanceId: string
  nodeId: string
  nodeName: string
  taskId: string
  action: string
  operator: string
  comment?: string
  outcome?: string
  createdAt: Date
}

const approvalLogSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  tenantId: { type: String, default: '000000', index: true },
  instanceId: { type: String, required: true, index: true },
  nodeId: { type: String, required: true },
  nodeName: { type: String, required: true },
  taskId: { type: String, required: true },
  action: { type: String, required: true },
  operator: { type: String, required: true },
  comment: { type: String, default: null },
  outcome: { type: String, default: null },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: {
    transform(_doc: unknown, ret: Record<string, unknown>) {
      ret.id = ret._id
      delete ret._id
      delete ret.__v
    },
  },
})

approvalLogSchema.index({ instanceId: 1, createdAt: 1 })

approvalLogSchema.plugin(tenantPlugin)

export const ApprovalLogModel =
  mongoose.models.ApprovalLog ??
  mongoose.model<IApprovalLog>('ApprovalLog', approvalLogSchema)
