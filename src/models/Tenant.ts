import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'

export interface ITenant {
  _id: string
  name: string
  code: string
  status: 'active' | 'inactive' | 'suspended'
  config: {
    maxUsers: number
    features: string[]
  }
  createdAt: Date
  updatedAt: Date
}

const tenantSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
    config: {
      maxUsers: { type: Number, default: 100 },
      features: { type: [String], default: [] },
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

tenantSchema.index({ status: 1 })
tenantSchema.index({ name: 1 })

export const TenantModel =
  mongoose.models.Tenant ?? mongoose.model<ITenant>('Tenant', tenantSchema)
