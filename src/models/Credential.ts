import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export type CredentialType = 'api_key' | 'basic_auth' | 'bearer_token'

export interface ICredential {
  _id: string
  name: string
  type: CredentialType
  data: string  // encrypted JSON string
  tenantId: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

const credentialSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ['api_key', 'basic_auth', 'bearer_token'],
    },
    data: { type: String, required: true },  // encrypted blob
    tenantId: { type: String, default: '000000', index: true },
    createdBy: { type: String, required: true },
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

credentialSchema.index({ tenantId: 1, name: 1 })
credentialSchema.index({ tenantId: 1, type: 1 })
credentialSchema.index({ tenantId: 1, createdBy: 1 })

credentialSchema.plugin(tenantPlugin)

export const CredentialModel =
  mongoose.models.Credential ?? mongoose.model<ICredential>('Credential', credentialSchema)
