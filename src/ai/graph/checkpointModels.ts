/**
 * MongoDB models for LangGraph checkpoint persistence.
 *
 * Two collections:
 * - ai_checkpoints: stores checkpoint data + metadata per thread
 * - ai_checkpoint_writes: stores pending writes linked to a checkpoint
 */

import mongoose, { Schema, type Document } from 'mongoose'

// ────────────────────────────────────────────
// Checkpoint document
// ────────────────────────────────────────────

export interface ICheckpointDoc extends Document {
  thread_id: string
  checkpoint_ns: string
  checkpoint_id: string
  parent_checkpoint_id?: string
  checkpoint: string      // JSON-serialized Checkpoint
  metadata: string        // JSON-serialized CheckpointMetadata
  created_at: Date
}

const checkpointSchema = new Schema<ICheckpointDoc>({
  thread_id: { type: String, required: true },
  checkpoint_ns: { type: String, required: true, default: '' },
  checkpoint_id: { type: String, required: true },
  parent_checkpoint_id: { type: String },
  checkpoint: { type: String, required: true },
  metadata: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
})

// Compound unique index: one checkpoint per (thread, ns, id)
checkpointSchema.index(
  { thread_id: 1, checkpoint_ns: 1, checkpoint_id: 1 },
  { unique: true },
)

// Index for listing: sort by checkpoint_id descending within a thread
checkpointSchema.index({ thread_id: 1, checkpoint_ns: 1, checkpoint_id: -1 })

export const CheckpointModel = mongoose.model<ICheckpointDoc>(
  'Checkpoint',
  checkpointSchema,
  'ai_checkpoints',
)

// ────────────────────────────────────────────
// Checkpoint writes document
// ────────────────────────────────────────────

export interface ICheckpointWriteDoc extends Document {
  thread_id: string
  checkpoint_ns: string
  checkpoint_id: string
  task_id: string
  idx: number
  channel: string
  value: string            // JSON-serialized value
}

const checkpointWriteSchema = new Schema<ICheckpointWriteDoc>({
  thread_id: { type: String, required: true },
  checkpoint_ns: { type: String, required: true, default: '' },
  checkpoint_id: { type: String, required: true },
  task_id: { type: String, required: true },
  idx: { type: Number, required: true },
  channel: { type: String, required: true },
  value: { type: String, required: true },
})

// Compound unique index: one write per (thread, ns, checkpoint, task, idx)
checkpointWriteSchema.index(
  { thread_id: 1, checkpoint_ns: 1, checkpoint_id: 1, task_id: 1, idx: 1 },
  { unique: true },
)

// Index for lookup by checkpoint
checkpointWriteSchema.index(
  { thread_id: 1, checkpoint_ns: 1, checkpoint_id: 1 },
)

export const CheckpointWriteModel = mongoose.model<ICheckpointWriteDoc>(
  'CheckpointWrite',
  checkpointWriteSchema,
  'ai_checkpoint_writes',
)
