/**
 * AI 文档原文件磁盘存储（~/payflow/schema-flow/ai-documents/）
 */

import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import {
  buildDocumentRelativePath,
  extensionFromFilename,
  resolveDocumentStorageDir,
  resolveDocumentStorageRoot,
} from '../config/documentStorage.js'

export function toAbsoluteStoragePath(relativePath: string): string {
  const root = resolveDocumentStorageRoot()
  const abs = path.resolve(root, relativePath)
  if (!abs.startsWith(root)) {
    throw new Error('Invalid document storage path')
  }
  return abs
}

export async function ensureDocumentStorageRoot(): Promise<void> {
  await fs.mkdir(resolveDocumentStorageDir(), { recursive: true })
}

export async function saveDocumentFile(
  tenantId: string,
  documentId: string,
  buffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<string> {
  await ensureDocumentStorageRoot()
  const ext = extensionFromFilename(filename, mimetype)
  const relativePath = buildDocumentRelativePath(tenantId, documentId, ext)
  const absPath = toAbsoluteStoragePath(relativePath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, buffer)
  return relativePath
}

export async function readDocumentFile(relativePath: string): Promise<Buffer> {
  const absPath = toAbsoluteStoragePath(relativePath)
  return fs.readFile(absPath)
}

export function openDocumentFileStream(relativePath: string) {
  const absPath = toAbsoluteStoragePath(relativePath)
  return createReadStream(absPath)
}

export async function documentFileExists(relativePath: string): Promise<boolean> {
  try {
    const absPath = toAbsoluteStoragePath(relativePath)
    await fs.access(absPath)
    return true
  } catch {
    return false
  }
}
