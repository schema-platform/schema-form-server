/**
 * AI 文档原文件存储根目录
 *
 * 默认：~/payflow/schema-flow/ai-documents/
 * 可通过 AI_DOCUMENT_STORAGE_ROOT 覆盖根路径（支持 ~ 展开）
 */

import os from 'node:os'
import path from 'node:path'

const SUBDIR = 'ai-documents'

export { SUBDIR as AI_DOCUMENT_SUBDIR }

export function resolveDocumentStorageRoot(): string {
  const raw = process.env.AI_DOCUMENT_STORAGE_ROOT
    || path.join(os.homedir(), 'payflow', 'schema-flow')
  const expanded = raw.startsWith('~')
    ? path.join(os.homedir(), raw.slice(1))
    : raw
  return path.resolve(expanded)
}

export function resolveDocumentStorageDir(): string {
  return path.join(resolveDocumentStorageRoot(), SUBDIR)
}

export function buildDocumentRelativePath(
  tenantId: string,
  documentId: string,
  ext: string,
): string {
  const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_') || '000000'
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`
  return path.join(SUBDIR, safeTenant, documentId, `original${normalizedExt}`)
}

export function extensionFromFilename(filename: string, mimetype: string): string {
  const fromName = path.extname(filename)
  if (fromName) return fromName.toLowerCase()

  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/plain': '.txt',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
  }
  return map[mimetype] ?? '.bin'
}
