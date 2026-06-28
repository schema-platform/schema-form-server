import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IPermission {
  tenantId: string
  code: string        // 权限编码，如 flow:design, flow:approve
  name: string        // 权限名称
  module: string      // 所属模块：flow, schema, system
  description?: string
  createdAt: Date
  updatedAt: Date
}

const permissionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: '000000', index: true },
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    module: { type: String, required: true, enum: ['flow', 'schema', 'system', 'tenant', 'user', 'role', 'menu', 'dept'] },
    description: { type: String },
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

permissionSchema.index({ module: 1 })
// code 已有 unique: true 自动建索引，无需重复声明

permissionSchema.plugin(tenantPlugin)

export const PermissionModel =
  mongoose.models.Permission ?? mongoose.model<IPermission>('Permission', permissionSchema)
