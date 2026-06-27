/**
 * Prompt Template Model.
 *
 * Stores prompt templates with metadata, variables, and versioning.
 * Supports CRUD operations, categorization, and usage tracking.
 */

import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import { tenantPlugin } from '../../middleware/tenantPlugin.js'

// ────────────────────────────────────────────
// Interfaces
// ────────────────────────────────────────────

export interface IPromptTemplate {
  _id: string
  tenantId: string
  name: string
  description: string
  category: 'schema' | 'flow' | 'general' | 'custom'
  template: string
  variables: string[]
  /** Usage count — incremented each time the template is used */
  usageCount: number
  /** Average success rate from feedback (0-1) */
  successRate?: number
  /** Whether this is a built-in (system) template */
  isBuiltin: boolean
  /** Tags for search/filtering */
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

// ────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────

const promptTemplateSchema = new mongoose.Schema<IPromptTemplate>(
  {
    _id: { type: String, default: uuidv4 },
    tenantId: { type: String, default: '000000', index: true },
    name: {
      type: String,
      required: true,
      maxlength: 200,
      index: true,
    },
    description: {
      type: String,
      default: '',
      maxlength: 1000,
    },
    category: {
      type: String,
      enum: ['schema', 'flow', 'general', 'custom'],
      default: 'custom',
      index: true,
    },
    template: {
      type: String,
      required: true,
    },
    variables: {
      type: [String],
      default: [],
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    successRate: {
      type: Number,
      min: 0,
      max: 1,
    },
    isBuiltin: {
      type: Boolean,
      default: false,
    },
    tags: {
      type: [String],
      default: [],
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

// Indexes for common queries
promptTemplateSchema.index({ category: 1, usageCount: -1 })
promptTemplateSchema.index({ tags: 1 })
promptTemplateSchema.index({ name: 'text', description: 'text' })

promptTemplateSchema.plugin(tenantPlugin)

// ────────────────────────────────────────────
// Model
// ────────────────────────────────────────────

export const PromptTemplateModel =
  mongoose.models.PromptTemplate ?? mongoose.model<IPromptTemplate>('PromptTemplate', promptTemplateSchema)
