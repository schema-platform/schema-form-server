/**
 * Prompt Version Model.
 *
 * Stores versioned prompts with optimization metadata.
 * Supports version history, success rate tracking, and rollback.
 */

import mongoose from 'mongoose'
import { tenantPlugin } from '../../middleware/tenantPlugin.js'

// ────────────────────────────────────────────
// Interfaces
// ────────────────────────────────────────────

export interface IPromptVersion {
  _id: string
  tenantId: string
  promptId: string
  version: number
  content: string
  successRate?: number
  feedbackCount: number
  optimizationReason?: string
  createdAt: Date
}

// ────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────

const promptVersionSchema = new mongoose.Schema<IPromptVersion>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    version: {
      type: Number,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    successRate: {
      type: Number,
      min: 0,
      max: 1,
    },
    feedbackCount: {
      type: Number,
      default: 0,
    },
    optimizationReason: {
      type: String,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
      },
    },
  },
)

// Compound index: unique version per prompt
promptVersionSchema.index({ promptId: 1, version: -1 })
promptVersionSchema.index({ promptId: 1, createdAt: -1 })

promptVersionSchema.plugin(tenantPlugin)

// ────────────────────────────────────────────
// Model
// ────────────────────────────────────────────

export const PromptVersionModel =
  (mongoose.models.PromptVersion as mongoose.Model<IPromptVersion>) ?? mongoose.model<IPromptVersion>('PromptVersion', promptVersionSchema)
