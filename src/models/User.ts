import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

const SALT_ROUNDS = 10

export type UserStatus = 'active' | 'inactive' | 'disabled'

export interface IUser {
  _id: string
  username: string
  password: string
  displayName: string
  roles: string[]  // 角色ID数组
  postIds: string[]  // 岗位ID数组
  tenantId: string
  deptId: string | null
  email: string | null
  phone: string | null
  avatar: string
  status: UserStatus
  createdAt: Date
  updatedAt: Date
}

const userSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    username: { type: String, required: true },
    password: { type: String, required: true },
    displayName: { type: String, required: true },
    roles: { type: [String], default: [] },  // 角色ID数组
    postIds: { type: [String], default: [] },  // 岗位ID数组
    tenantId: { type: String, default: '000000', index: true },
    deptId: { type: String, default: null },
    email: { type: String, default: null },
    phone: { type: String, default: null },
    avatar: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive', 'disabled'], default: 'active' },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        delete ret.password
      },
    },
  },
)

// 给 roles 字段添加索引，支持反向查询
userSchema.index({ roles: 1 })
// 复合唯一索引：同一租户内 username 唯一
userSchema.index({ tenantId: 1, username: 1 }, { unique: true })
// 复合索引：租户+状态、租户+部门
userSchema.index({ tenantId: 1, status: 1 })
userSchema.index({ tenantId: 1, deptId: 1 })

userSchema.plugin(tenantPlugin)

userSchema.pre('save', async function (this: IUser & mongoose.Document) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, SALT_ROUNDS)
  }
})

userSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password)
}

export const UserModel =
  mongoose.models.User ?? mongoose.model<IUser>('User', userSchema)
