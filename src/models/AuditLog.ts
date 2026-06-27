import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IAuditLog {
  _id: string
  tenantId: string
  userId: string
  username: string
  module: string
  action: 'create' | 'update' | 'delete' | 'login' | 'logout' | 'export' | 'import' | 'other'
  targetId: string | null
  targetName: string
  method: string
  url: string
  ip: string
  userAgent: string
  requestBody: Record<string, unknown> | null
  responseBody: Record<string, unknown> | null
  controllerMethod: string
  status: 'success' | 'fail'
  errorMsg: string
  errorStack: string
  duration: number
  createdAt: Date
  updatedAt: Date
}

const auditLogSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    tenantId: { type: String, default: '000000', index: true },
    userId: { type: String, default: '', index: true },
    username: { type: String, default: '' },
    module: { type: String, default: '', index: true },
    action: {
      type: String,
      enum: ['create', 'update', 'delete', 'login', 'logout', 'export', 'import', 'other'],
      default: 'other',
      index: true,
    },
    targetId: { type: String, default: null },
    targetName: { type: String, default: '' },
    method: { type: String, default: '' },
    url: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    requestBody: { type: mongoose.Schema.Types.Mixed, default: null },
    responseBody: { type: mongoose.Schema.Types.Mixed, default: null },
    controllerMethod: { type: String, default: '' },
    status: { type: String, enum: ['success', 'fail'], default: 'success', index: true },
    errorMsg: { type: String, default: '' },
    errorStack: { type: String, default: '' },
    duration: { type: Number, default: 0 },
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

auditLogSchema.index({ tenantId: 1, createdAt: -1 })
auditLogSchema.index({ tenantId: 1, module: 1, createdAt: -1 })
auditLogSchema.index({ tenantId: 1, userId: 1, createdAt: -1 })

auditLogSchema.plugin(tenantPlugin)

export const AuditLogModel =
  mongoose.models.AuditLog ?? mongoose.model<IAuditLog>('AuditLog', auditLogSchema)
