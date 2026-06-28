/**
 * User Plugin Installation Model
 *
 * Tracks which plugins a user has installed and their per-user configuration.
 */

import mongoose from 'mongoose'
import { tenantPlugin } from '../../middleware/tenantPlugin.js'

export interface IUserPlugin {
  tenantId: string
  userId: string
  pluginId: string
  config: Record<string, unknown>
  enabled: boolean
  installedAt: Date
  updatedAt: Date
}

const userPluginSchema = new mongoose.Schema<IUserPlugin>(
  {
    tenantId: { type: String, default: '000000', index: true },
    userId: { type: String, required: true },
    pluginId: { type: String, required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    enabled: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: 'installedAt', updatedAt: true },
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
      },
    },
  },
)

userPluginSchema.index({ userId: 1, pluginId: 1 }, { unique: true })
userPluginSchema.index({ userId: 1 })

userPluginSchema.plugin(tenantPlugin)

export const UserPluginModel =
  mongoose.models.UserPlugin ?? mongoose.model<IUserPlugin>('UserPlugin', userPluginSchema)
