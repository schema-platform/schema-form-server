import mongoose from 'mongoose'
import { randomBytes } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export type ApiKeyStatus = 'active' | 'disabled'

export interface IApiKey {
  _id: string
  name: string
  key: string
  tenantId: string
  createdBy: string
  permissions: string[]
  status: ApiKeyStatus
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function generateApiKey(): string {
  return `sk-${randomBytes(32).toString('hex')}`
}

const apiKeySchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    name: { type: String, required: true },
    key: { type: String, required: true, unique: true, default: generateApiKey },
    tenantId: { type: String, default: '000000', index: true },
    createdBy: { type: String, required: true, index: true },
    permissions: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
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

apiKeySchema.plugin(tenantPlugin)

// 租户内按状态查询
apiKeySchema.index({ tenantId: 1, status: 1 })
// 按 key 精确查询（用于认证）
apiKeySchema.index({ key: 1 })
// 租户内按创建者查询
apiKeySchema.index({ tenantId: 1, createdBy: 1 })

export const ApiKeyModel =
  mongoose.models.ApiKey ?? mongoose.model<IApiKey>('ApiKey', apiKeySchema)
