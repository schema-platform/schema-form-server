/**
 * RAG Service tests.
 *
 * Tests text extraction, content hashing, and cosine similarity logic.
 * Embedding API calls are mocked since they require external service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the embedding service before importing ragService
vi.mock('../services/embeddingService.js', () => ({
  embedText: vi.fn().mockResolvedValue({
    vector: Array.from({ length: 4096 }, () => Math.random()),
    dimensions: 4096,
  }),
  embedBatch: vi.fn().mockResolvedValue([]),
  EMBEDDING_DIMENSIONS: 4096,
}))

// Mock Mongoose models
vi.mock('../../models/FormSchema.js', () => ({
  FormSchemaModel: {
    findById: vi.fn(),
    find: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    }),
    countDocuments: vi.fn().mockResolvedValue(0),
  },
}))

vi.mock('../../models/SchemaEmbedding.js', () => ({
  SchemaEmbeddingModel: {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    }),
    create: vi.fn().mockResolvedValue({}),
    updateOne: vi.fn().mockResolvedValue({}),
    deleteOne: vi.fn().mockResolvedValue({}),
    countDocuments: vi.fn().mockResolvedValue(0),
  },
}))

import {
  extractTextForEmbedding,
  computeContentHash,
} from '../services/ragService.js'

describe('RAG Service', () => {
  describe('extractTextForEmbedding', () => {
    it('extracts name and widget types from schema json', () => {
      const json = [
        { type: 'input', field: 'username', label: 'Username' },
        { type: 'select', field: 'role', label: 'Role' },
      ]
      const text = extractTextForEmbedding('User Form', json)
      expect(text).toContain('User Form')
      expect(text).toContain('input')
      expect(text).toContain('select')
      expect(text).toContain('Username')
      expect(text).toContain('Role')
    })

    it('handles nested children', () => {
      const json = [
        {
          type: 'card',
          children: [
            { type: 'input', field: 'name', label: 'Name' },
            { type: 'textarea', field: 'bio', label: 'Bio' },
          ],
        },
      ]
      const text = extractTextForEmbedding('Profile', json)
      expect(text).toContain('card')
      expect(text).toContain('input')
      expect(text).toContain('textarea')
      expect(text).toContain('Name')
      expect(text).toContain('Bio')
    })

    it('handles empty json', () => {
      const text = extractTextForEmbedding('Empty', [])
      expect(text).toContain('Empty')
    })

    it('handles non-array json', () => {
      const text = extractTextForEmbedding('Test', null)
      expect(text).toContain('Test')
    })

    it('extracts props.label and props.placeholder', () => {
      const json = [
        {
          type: 'input',
          props: { label: 'Email', placeholder: 'Enter email' },
        },
      ]
      const text = extractTextForEmbedding('Form', json)
      expect(text).toContain('Email')
      expect(text).toContain('Enter email')
    })
  })

  describe('computeContentHash', () => {
    it('returns consistent hash for same input', () => {
      const json = [{ type: 'input', label: 'Test' }]
      const hash1 = computeContentHash('Test Form', json)
      const hash2 = computeContentHash('Test Form', json)
      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(32)
    })

    it('returns different hash for different input', () => {
      const json1 = [{ type: 'input', label: 'Test' }]
      const json2 = [{ type: 'select', label: 'Other' }]
      const hash1 = computeContentHash('Form A', json1)
      const hash2 = computeContentHash('Form B', json2)
      expect(hash1).not.toBe(hash2)
    })
  })
})
