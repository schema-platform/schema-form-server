/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  saveDocumentFile,
  readDocumentFile,
  documentFileExists,
} from '../services/documentFileStorage.js'

describe('documentFileStorage', () => {
  let tempRoot = ''

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-doc-storage-'))
    process.env.AI_DOCUMENT_STORAGE_ROOT = tempRoot
  })

  afterEach(async () => {
    delete process.env.AI_DOCUMENT_STORAGE_ROOT
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('saves and reads document under tenant/documentId', async () => {
    const buffer = Buffer.from('hello document')
    const relativePath = await saveDocumentFile('000000', 'doc123', buffer, 'test.txt', 'text/plain')
    expect(await documentFileExists(relativePath)).toBe(true)
    const read = await readDocumentFile(relativePath)
    expect(read.toString('utf-8')).toBe('hello document')
    expect(relativePath).toContain('ai-documents')
    expect(relativePath).toContain('doc123')
  })
})
