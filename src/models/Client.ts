import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export type ClientType = 'confidential' | 'public'
export type ClientStatus = 'active' | 'disabled'

export interface IClient {
  clientId: string
  name: string
  secret: string
  redirectUris: string[]
  scopes: string[]
  type: ClientType
  status: ClientStatus
  tenantId: string
  createdAt: Date
  updatedAt: Date
}

const clientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    secret: { type: String, required: true },
    redirectUris: { type: [String], default: [] },
    scopes: { type: [String], default: ['openid', 'profile', 'email'] },
    type: { type: String, enum: ['confidential', 'public'], default: 'confidential' },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    tenantId: { type: String, default: '000000', index: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
        // secret 不应暴露给客户端
        delete ret.secret
      },
    },
  },
)

// 租户内按状态查询
clientSchema.index({ tenantId: 1, status: 1 })

clientSchema.plugin(tenantPlugin)

export const ClientModel =
  mongoose.models.Client ?? mongoose.model<IClient>('Client', clientSchema)
