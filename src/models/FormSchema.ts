import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IVersionSnapshot {
  version: string
  json: Record<string, unknown>
  createdAt: Date
}

export interface IFormSchema {
  _id: string
  tenantId: string
  editId: string
  version: string
  name: string
  type: 'form' | 'search_list'
  status: 'draft'
  json: Record<string, unknown>
  thumbnail?: string
  createdBy: string | null
  versions: IVersionSnapshot[]
  createdAt: Date
  updatedAt: Date
}

const versionSnapshotSchema = new mongoose.Schema(
  {
    version: { type: String, required: true },
    json: { type: mongoose.Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
)

const formSchemaDef = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    editId: { type: String, required: true, unique: true, index: true },
    version: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['form', 'search_list', 'layout', 'table', 'chart', 'business', 'report', 'other'], default: 'form' },
    status: { type: String, enum: ['draft'], default: 'draft' },
    json: { type: mongoose.Schema.Types.Mixed, required: true },
    thumbnail: { type: String, default: '' },
    createdBy: { type: String, default: null, index: true },
    versions: { type: [versionSnapshotSchema], default: [] },
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

formSchemaDef.plugin(tenantPlugin)

// ── Post-save hook: auto-trigger RAG indexing ──
// Fire-and-forget: indexing is async and does not block the save response.
// Failures are logged but do not propagate to the caller.
formSchemaDef.post('save', function (doc: IFormSchema) {
  const schemaId = doc._id
  // Dynamic import to avoid circular dependency with ragService → FormSchemaModel
  import('../ai/services/ragService.js')
    .then(({ indexSchema }) => indexSchema(schemaId))
    .then((result) => {
      if (result.action !== 'skipped') {
        console.log(`[RAG] Auto-indexed schema ${schemaId}: ${result.action}`)
      }
    })
    .catch((err: unknown) => {
      console.error(`[RAG] Auto-index failed for schema ${schemaId}:`, err instanceof Error ? err.message : String(err))
    })
})

// Also trigger on findOneAndUpdate (used by update routes)
formSchemaDef.post('findOneAndUpdate', function (doc: IFormSchema | null) {
  if (!doc) return
  const schemaId = doc._id
  import('../ai/services/ragService.js')
    .then(({ indexSchema }) => indexSchema(schemaId))
    .then((result) => {
      if (result.action !== 'skipped') {
        console.log(`[RAG] Auto-indexed schema ${schemaId}: ${result.action}`)
      }
    })
    .catch((err: unknown) => {
      console.error(`[RAG] Auto-index failed for schema ${schemaId}:`, err instanceof Error ? err.message : String(err))
    })
})

export const FormSchemaModel =
  mongoose.models.FormSchema ?? mongoose.model<IFormSchema>('FormSchema', formSchemaDef)
