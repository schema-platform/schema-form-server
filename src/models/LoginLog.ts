import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface ILoginLog {
  _id: string
  tenantId: string
  username: string
  status: 'success' | 'fail'
  ip: string
  userAgent: string
  message: string
  loginTime: Date
  createdAt: Date
}

const loginLogSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    tenantId: { type: String, default: '000000', index: true },
    username: { type: String, required: true, index: true },
    status: { type: String, enum: ['success', 'fail'], required: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    message: { type: String, default: '' },
    loginTime: { type: Date, default: Date.now },
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

loginLogSchema.index({ tenantId: 1, loginTime: -1 })
loginLogSchema.index({ tenantId: 1, status: 1 })
loginLogSchema.index({ tenantId: 1, username: 1, loginTime: -1 })

loginLogSchema.plugin(tenantPlugin)

export const LoginLogModel =
  mongoose.models.LoginLog ?? mongoose.model<ILoginLog>('LoginLog', loginLogSchema)
