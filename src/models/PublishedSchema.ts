import mongoose from 'mongoose'
import { tenantPlugin } from '../middleware/tenantPlugin.js'

export interface IPublishedSchema {
  _id: string
  tenantId: string
  sourceId: string
  name: string
  type: 'form' | 'search_list'
  json: Record<string, unknown>
  thumbnail?: string
  publishId: string
  version: string
  publishedAt: Date
  createdAt: Date
  updatedAt: Date
}

const publishedSchemaDef = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, default: '000000', index: true },
    sourceId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['form', 'search_list'], default: 'form' },
    json: { type: mongoose.Schema.Types.Mixed, required: true },
    thumbnail: { type: String, default: '' },
    publishId: { type: String, required: true, index: true },
    version: { type: String, required: true },
    publishedAt: { type: Date, required: true },
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

publishedSchemaDef.plugin(tenantPlugin)

export const PublishedSchemaModel =
  mongoose.models.PublishedSchema ?? mongoose.model<IPublishedSchema>('PublishedSchema', publishedSchemaDef)
