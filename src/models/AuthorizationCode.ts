import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'

export interface IAuthorizationCode {
  _id: string
  code: string
  clientId: string
  userId: string
  redirectUri: string
  scopes: string[]
  expiresAt: Date
  used: boolean
  createdAt: Date
  updatedAt: Date
}

const authorizationCodeSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    code: { type: String, required: true, unique: true, index: true },
    clientId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    redirectUri: { type: String, required: true },
    scopes: { type: [String], default: [] },
    expiresAt: { type: Date, required: true, index: true },
    used: { type: Boolean, default: false },
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

// TTL 索引：过期后自动清理
authorizationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
// 按 clientId + used 查询
authorizationCodeSchema.index({ clientId: 1, used: 1 })

// AuthorizationCode 是临时数据，不应用 tenantPlugin

export const AuthorizationCodeModel =
  mongoose.models.AuthorizationCode ??
  mongoose.model<IAuthorizationCode>('AuthorizationCode', authorizationCodeSchema)
