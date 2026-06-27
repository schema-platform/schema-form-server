import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export type DataScope = 'all' | 'dept' | 'self' | 'custom'

export interface IRole {
  _id: string
  tenantId: string
  name: string
  description?: string
  permissions: string[]  // 权限编码数组
  data_scope: DataScope
  dept_ids: string[]     // custom 模式下的部门 ID 列表
  createdAt: Date
  updatedAt: Date
}

const roleSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true, unique: true },
    description: { type: String },
    permissions: { type: [String], default: [] },  // 权限编码数组
    data_scope: { type: String, enum: ['all', 'dept', 'self', 'custom'], default: 'all' },
    dept_ids: { type: [String], default: [] },  // custom 模式下的部门 ID 列表
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

roleSchema.index({ permissions: 1 })
roleSchema.index({ data_scope: 1 })

roleSchema.plugin(tenantPlugin)

export const RoleModel =
  mongoose.models.Role ?? mongoose.model<IRole>('Role', roleSchema)
