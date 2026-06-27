/**
 * Collaboration Session Model
 *
 * Tracks multi-user collaboration on AI conversations.
 * Each session maps a conversationId to a set of active participants.
 */

import mongoose from 'mongoose'
import { tenantPlugin } from '../../middleware/tenantPlugin.js'

// ────────────────────────────────────────────
// Interfaces
// ────────────────────────────────────────────

export interface ICollaborationSession {
  _id: string
  tenantId: string
  conversationId: string
  participants: string[]
  createdAt: Date
  updatedAt: Date
}

// ────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────

const collaborationSessionSchema = new mongoose.Schema<ICollaborationSession>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    conversationId: { type: String, required: true, index: true },
    participants: { type: [String], default: [] },
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

collaborationSessionSchema.index({ conversationId: 1 }, { unique: true })

collaborationSessionSchema.plugin(tenantPlugin)

// ────────────────────────────────────────────
// Model
// ────────────────────────────────────────────

export const CollaborationSessionModel =
  mongoose.models.CollaborationSession ??
  mongoose.model<ICollaborationSession>('CollaborationSession', collaborationSessionSchema)
