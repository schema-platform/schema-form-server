/**
 * AI 文档 MongoDB 模型 — 上传、解析、分块与摘要
 */

import mongoose from 'mongoose'
import { tenantPlugin } from '../../middleware/tenantPlugin.js'

export interface DocumentChunk {
  page: number
  text: string
  startOffset: number
}

export interface StructuredSummary {
  title: string
  summary: string
  keyPoints: string[]
  sections: Array<{ heading: string; content: string }>
  entities?: string[]
  generatedAt: string
}

export type DocumentExtractionMethod =
  | 'ocr'
  | 'pdf'
  | 'docx'
  | 'txt'
  | 'empty'

export interface IDocument {
  tenantId: string
  filename: string
  mimetype: string
  size: number
  text: string
  chunks: DocumentChunk[]
  summary?: StructuredSummary
  /** 相对 AI_DOCUMENT_STORAGE_ROOT 的原文件路径 */
  storagePath?: string
  extractionMethod?: DocumentExtractionMethod
  uploadedBy: string
  createdAt: Date
  updatedAt: Date
}

const chunkSchema = new mongoose.Schema(
  {
    page: { type: Number, required: true },
    text: { type: String, required: true },
    startOffset: { type: Number, required: true },
  },
  { _id: false },
)

const summarySectionSchema = new mongoose.Schema(
  {
    heading: { type: String, required: true },
    content: { type: String, required: true },
  },
  { _id: false },
)

const summarySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    summary: { type: String, required: true },
    keyPoints: { type: [String], default: [] },
    sections: { type: [summarySectionSchema], default: [] },
    entities: { type: [String], default: [] },
    generatedAt: { type: String, required: true },
  },
  { _id: false },
)

const documentSchema = new mongoose.Schema(
  {
    tenantId: { type: String, default: '000000', index: true },
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    text: { type: String, default: '' },
    chunks: { type: [chunkSchema], default: [] },
    summary: { type: summarySchema, default: null },
    storagePath: { type: String, default: null },
    extractionMethod: {
      type: String,
      enum: ['ocr', 'pdf', 'docx', 'txt', 'empty'],
      default: null,
    },
    uploadedBy: { type: String, required: true, index: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
      },
    },
  },
)

documentSchema.plugin(tenantPlugin)

export const DocumentModel = mongoose.model<IDocument>('AiDocument', documentSchema)
