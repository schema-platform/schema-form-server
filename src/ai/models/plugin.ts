/**
 * AI Plugin Model
 *
 * Represents an installable plugin for the AI agent system.
 * Plugins can extend agent capabilities with custom tools, prompts, and configurations.
 */

import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../../middleware/tenantPlugin.js'

export interface IPluginTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface IPlugin {
  _id: string
  tenantId: string
  name: string
  description: string
  author: string
  version: string
  category: 'productivity' | 'development' | 'business' | 'other'
  icon: string
  config: Record<string, unknown>
  tools: IPluginTool[]
  prompt: string
  downloads: number
  rating: number
  isBuiltin: boolean
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

const pluginToolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    parameters: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false },
)

const pluginSchema = new mongoose.Schema<IPlugin>(
  {
    _id: { type: String, default: uuidv4 },
    tenantId: { type: String, default: '000000', index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    author: { type: String, default: 'system' },
    version: { type: String, default: '1.0.0' },
    category: {
      type: String,
      enum: ['productivity', 'development', 'business', 'other'],
      default: 'other',
      index: true,
    },
    icon: { type: String, default: '' },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    tools: { type: [pluginToolSchema], default: [] },
    prompt: { type: String, default: '' },
    downloads: { type: Number, default: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    isBuiltin: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
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

pluginSchema.index({ name: 'text', description: 'text' })
pluginSchema.index({ downloads: -1 })
pluginSchema.index({ category: 1, downloads: -1 })

pluginSchema.plugin(tenantPlugin)

export const PluginModel =
  (mongoose.models.Plugin as mongoose.Model<IPlugin>) ?? mongoose.model<IPlugin>('Plugin', pluginSchema)
