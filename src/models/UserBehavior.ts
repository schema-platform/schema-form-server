import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IUserBehavior {
  _id: string
  tenantId: string
  userId: string
  action: 'use_component' | 'set_property' | 'create_schema' | 'generate_ai'
  target?: string
  data: Record<string, unknown>
  createdAt: Date
}

const userBehaviorSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    userId: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: ['use_component', 'set_property', 'create_schema', 'generate_ai'],
      required: true,
      index: true,
    },
    target: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
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
  }
)

// 复合索引：用户 + 动作类型查询优化
userBehaviorSchema.index({ userId: 1, action: 1, createdAt: -1 })

// TTL 索引：90 天后自动清理行为数据
userBehaviorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })

userBehaviorSchema.plugin(tenantPlugin)

export const UserBehaviorModel =
  mongoose.models.UserBehavior ?? mongoose.model<IUserBehavior>('UserBehavior', userBehaviorSchema)
