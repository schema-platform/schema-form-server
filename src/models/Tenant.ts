import mongoose from 'mongoose'

export interface ITenant {
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
        ret.id = String(ret._id)
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
