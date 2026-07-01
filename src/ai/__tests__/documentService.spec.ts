/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { chunkText } from '../services/documentService.js'

describe('documentService.chunkText', () => {
  it('returns empty array for empty text', () => {
    expect(chunkText('')).toEqual([])
  })

  it('splits long text into multiple chunks with page numbers', () => {
    const text = 'a'.repeat(9000)
    const chunks = chunkText(text, 4000)
    expect(chunks).toHaveLength(3)
    expect(chunks[0].page).toBe(1)
    expect(chunks[1].page).toBe(2)
    expect(chunks[0].startOffset).toBe(0)
    expect(chunks[1].startOffset).toBe(4000)
    expect(chunks.map((c) => c.text).join('')).toBe(text)
  })
})
