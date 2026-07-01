/**
 * 文档服务 — 上传解析、磁盘存储、分块、结构化摘要
 */

import mongoose from 'mongoose'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import {
  DocumentModel,
  type DocumentChunk,
  type DocumentExtractionMethod,
  type StructuredSummary,
} from '../models/document.js'
import { processFile, isAllowedFileType, DOCUMENT_TEXT_MODEL } from './fileService.js'
import {
  saveDocumentFile,
  readDocumentFile,
  openDocumentFileStream,
  documentFileExists,
} from './documentFileStorage.js'
import { getLLM } from './llmCache.js'
import { docId } from '../../utils/objectId.js'

const CHUNK_SIZE = 4000

const SUMMARY_SYSTEM_PROMPT = `你是文档分析助手。根据用户提供的文档全文，输出结构化 JSON 摘要。

输出格式（严格 JSON，不要 markdown 代码块）：
{
  "title": "文档标题或主题",
  "summary": "200字以内的整体摘要",
  "keyPoints": ["要点1", "要点2"],
  "sections": [{"heading": "章节名", "content": "该章节摘要"}],
  "entities": ["关键实体/人名/组织等"]
}`

export function chunkText(text: string, chunkSize = CHUNK_SIZE): DocumentChunk[] {
  const chunks: DocumentChunk[] = []
  if (!text) return chunks

  let offset = 0
  let page = 1
  while (offset < text.length) {
    const slice = text.slice(offset, offset + chunkSize)
    chunks.push({ page, text: slice, startOffset: offset })
    offset += chunkSize
    page += 1
  }
  return chunks
}

function toDocumentRecord(doc: Record<string, unknown>) {
  return {
    id: docId(doc),
    filename: doc.filename as string,
    mimetype: doc.mimetype as string,
    size: doc.size as number,
    textLength: (doc.text as string)?.length ?? 0,
    chunkCount: Array.isArray(doc.chunks) ? doc.chunks.length : 0,
    hasSummary: !!doc.summary,
    hasOriginalFile: !!doc.storagePath,
    extractionMethod: doc.extractionMethod as DocumentExtractionMethod | undefined,
    summary: doc.summary as StructuredSummary | undefined,
    createdAt: (doc.createdAt as Date)?.toISOString?.() ?? String(doc.createdAt),
    updatedAt: (doc.updatedAt as Date)?.toISOString?.() ?? String(doc.updatedAt),
  }
}

function toPreview(doc: Record<string, unknown>) {
  const text = (doc.text as string) ?? ''
  return {
    id: docId(doc),
    filename: doc.filename as string,
    mimetype: doc.mimetype as string,
    size: doc.size as number,
    text,
    excerpt: text.slice(0, 500),
    chunks: (doc.chunks as DocumentChunk[]) ?? [],
    summary: doc.summary as StructuredSummary | undefined,
    hasOriginalFile: !!doc.storagePath,
    extractionMethod: doc.extractionMethod as DocumentExtractionMethod | undefined,
  }
}

async function persistProcessedDocument(params: {
  tenantId: string
  userId: string
  buffer: Buffer
  filename: string
  mimetype: string
}) {
  const { tenantId, userId, buffer, filename, mimetype } = params
  const processed = await processFile(buffer, filename, mimetype)
  const chunks = chunkText(processed.text)
  const documentId = new mongoose.Types.ObjectId()

  let storagePath: string | null = null
  try {
    storagePath = await saveDocumentFile(tenantId, String(documentId), buffer, filename, mimetype)
  } catch (err) {
    throw new Error(
      `Failed to store original file: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const doc = await DocumentModel.create({
    _id: documentId,
    tenantId,
    filename: processed.filename,
    mimetype: processed.mimetype,
    size: processed.size,
    text: processed.text,
    chunks,
    storagePath,
    extractionMethod: processed.extractionMethod,
    uploadedBy: userId,
  })

  return {
    doc,
    processed,
    chunks,
  }
}

export async function createDocumentFromUpload(
  buffer: Buffer,
  filename: string,
  mimetype: string,
  userId: string,
  tenantId = '000000',
) {
  if (!isAllowedFileType(mimetype)) {
    throw new Error(`Unsupported file type: ${mimetype}`)
  }

  const { doc, processed, chunks } = await persistProcessedDocument({
    tenantId,
    userId,
    buffer,
    filename,
    mimetype,
  })

  return {
    ...toDocumentRecord(doc.toJSON() as unknown as Record<string, unknown>),
    text: processed.text,
    chunks,
    dataUrl: processed.dataUrl,
    extractionMethod: processed.extractionMethod,
  }
}

export async function getDocumentById(
  id: string,
  userId?: string,
) {
  const filter: Record<string, unknown> = { _id: id }
  if (userId) filter.uploadedBy = userId

  const doc = await DocumentModel.findOne(filter).lean()
  if (!doc) return null
  return toDocumentRecord(doc as unknown as Record<string, unknown>)
}

export async function getDocumentWithText(
  id: string,
  userId?: string,
) {
  const filter: Record<string, unknown> = { _id: id }
  if (userId) filter.uploadedBy = userId

  const doc = await DocumentModel.findOne(filter).lean()
  if (!doc) return null
  return doc as unknown as Record<string, unknown>
}

export async function getDocumentPreview(id: string, userId: string) {
  const doc = await DocumentModel.findOne({ _id: id, uploadedBy: userId }).lean()
  if (!doc) return null
  return toPreview(doc as unknown as Record<string, unknown>)
}

export async function getDocumentFileMeta(id: string, userId: string) {
  const doc = await DocumentModel.findOne({ _id: id, uploadedBy: userId }).lean()
  if (!doc || !doc.storagePath) return null

  const exists = await documentFileExists(doc.storagePath as string)
  if (!exists) return null

  return {
    id: String(doc._id),
    filename: doc.filename as string,
    mimetype: doc.mimetype as string,
    size: doc.size as number,
    storagePath: doc.storagePath as string,
  }
}

export function openStoredDocumentFile(storagePath: string) {
  return openDocumentFileStream(storagePath)
}

export async function reprocessDocumentFromStorage(id: string, userId: string) {
  const doc = await DocumentModel.findOne({ _id: id, uploadedBy: userId })
  if (!doc) return null
  if (!doc.storagePath) {
    throw new Error('Original file not stored for this document')
  }

  const buffer = await readDocumentFile(doc.storagePath)
  const processed = await processFile(buffer, doc.filename, doc.mimetype)
  const chunks = chunkText(processed.text)

  doc.text = processed.text
  doc.chunks = chunks
  doc.extractionMethod = processed.extractionMethod
  doc.summary = undefined
  await doc.save()

  return {
    ...toDocumentRecord(doc.toJSON() as unknown as Record<string, unknown>),
    text: processed.text,
    chunks,
    extractionMethod: processed.extractionMethod,
  }
}

function parseSummaryJson(raw: string): StructuredSummary {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
  const parsed = JSON.parse(cleaned) as Record<string, unknown>
  return {
    title: String(parsed.title ?? '未命名文档'),
    summary: String(parsed.summary ?? ''),
    keyPoints: Array.isArray(parsed.keyPoints)
      ? parsed.keyPoints.map((p) => String(p))
      : [],
    sections: Array.isArray(parsed.sections)
      ? parsed.sections.map((s) => {
          const section = s as Record<string, unknown>
          return {
            heading: String(section.heading ?? ''),
            content: String(section.content ?? ''),
          }
        })
      : [],
    entities: Array.isArray(parsed.entities)
      ? parsed.entities.map((e) => String(e))
      : [],
    generatedAt: new Date().toISOString(),
  }
}

export async function summarizeDocument(
  id: string,
  userId: string,
  opts: { force?: boolean } = {},
) {
  const doc = await DocumentModel.findOne({ _id: id, uploadedBy: userId })
  if (!doc) return null

  if (doc.summary && !opts.force) {
    return {
      documentId: String(doc._id),
      filename: doc.filename,
      summary: doc.summary,
    }
  }

  if (!doc.text?.trim()) {
    if (doc.storagePath) {
      await reprocessDocumentFromStorage(id, userId)
      const refreshed = await DocumentModel.findOne({ _id: id, uploadedBy: userId })
      if (!refreshed?.text?.trim()) {
        throw new Error('Document has no extractable text after reparse')
      }
      doc.text = refreshed.text
    } else {
      throw new Error('Document has no extractable text')
    }
  }

  const llm = await getLLM({
    temperature: 0.2,
    maxTokens: 2048,
    model: DOCUMENT_TEXT_MODEL,
  })
  const response = await llm.invoke([
    new SystemMessage(SUMMARY_SYSTEM_PROMPT),
    new HumanMessage(`文档名：${doc.filename}\n\n全文：\n${doc.text.slice(0, 12000)}`),
  ])

  const content = typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content)

  const summary = parseSummaryJson(content)
  doc.summary = summary
  await doc.save()

  return {
    documentId: String(doc._id),
    filename: doc.filename,
    summary,
  }
}

export async function loadDocumentsForChat(
  documentIds: string[],
  userId: string,
) {
  const docs = await DocumentModel.find({
    _id: { $in: documentIds },
    uploadedBy: userId,
  }).lean()

  return docs.map((doc) => ({
    id: String(doc._id),
    filename: doc.filename as string,
    mimetype: doc.mimetype as string,
    size: doc.size as number,
    text: doc.text as string,
    summary: doc.summary as StructuredSummary | undefined,
    hasOriginalFile: !!doc.storagePath,
    extractionMethod: doc.extractionMethod as DocumentExtractionMethod | undefined,
  }))
}
