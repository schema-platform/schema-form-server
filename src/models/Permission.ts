import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IPermission {
  _id: string
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
    _id: { type: String, default: uuidv4 },
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
        ret.id = ret._id
        delete ret._id
        delete ret.__v
      },
    },
  },
)

permissionSchema.index({ module: 1 })
permissionSchema.index({ code: 1 })

permissionSchema.plugin(tenantPlugin)

export const PermissionModel =
  mongoose.models.Permission ?? mongoose.model<IPermission>('Permission', permissionSchema)
