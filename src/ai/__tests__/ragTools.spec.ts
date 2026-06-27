/**
 * RAG Tools tests.
 *
 * Tests the tool definitions and their schema validation.
 * Actual API calls are mocked.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock dependencies
vi.mock('../services/ragService.js', () => ({
  semanticSearch: vi.fn().mockResolvedValue([
    {
      schemaId: 'test-id-1',
      editId: 'edit-1',
      name: 'User Registration Form',
      type: 'form',
      score: 85,
      metadata: {
        widgetTypes: ['input', 'select', 'button'],
        fieldNames: ['username', 'email', 'role'],
        labels: ['Username', 'Email', 'Role'],
        description: 'A user registration form',
      },
    },
  ]),
  indexSchema: vi.fn().mockResolvedValue({ schemaId: 'test-id', action: 'created' }),
  reindexAll: vi.fn().mockResolvedValue({
    total: 5,
    created: 3,
    updated: 1,
    skipped: 1,
    errors: 0,
  }),
}))

vi.mock('../../models/FormSchema.js', () => ({
  FormSchemaModel: {
    findById: vi.fn(),
    countDocuments: vi.fn().mockResolvedValue(5),
  },
}))

vi.mock('../../models/SchemaEmbedding.js', () => ({
  SchemaEmbeddingModel: {
    countDocuments: vi.fn().mockResolvedValue(3),
  },
}))

import { ragSearchTool, ragIndexTool } from '../tools/ragTools.js'

describe('RAG Tools', () => {
  describe('ragSearchTool', () => {
    it('has correct name and description', () => {
      expect(ragSearchTool.name).toBe('rag_search')
      expect(ragSearchTool.description).toContain('向量智能匹配')
    })

    it('returns search results', async () => {
      const raw = await ragSearchTool.invoke({ query: 'user registration form', limit: 5 })
      const result = typeof raw === 'string' ? JSON.parse(raw) : raw
      expect(result.success).toBe(true)
      expect((result.data as Record<string, unknown>).total).toBe(1)
      expect(((result.data as Record<string, unknown>).schemas as Array<Record<string, unknown>>)[0].name).toBe('User Registration Form')
      expect(((result.data as Record<string, unknown>).schemas as Array<Record<string, unknown>>)[0].score).toBe(85)
    })

    it('returns summary with match count', async () => {
      const raw = await ragSearchTool.invoke({ query: 'user form' })
      const result = typeof raw === 'string' ? JSON.parse(raw) : raw
      expect(result.summary).toContain('1 个语义相关 Schema')
      expect(result.summary).toContain('85%')
    })
  })

  describe('ragIndexTool', () => {
    it('has correct name and description', () => {
      expect(ragIndexTool.name).toBe('rag_index')
      expect(ragIndexTool.description).toContain('向量索引')
    })

    it('indexes a single schema', async () => {
      const raw = await ragIndexTool.invoke({ schemaId: 'test-id' })
      const result = typeof raw === 'string' ? JSON.parse(raw) : raw
      expect(result.success).toBe(true)
      expect((result.data as Record<string, unknown>).action).toBe('created')
    })

    it('reindexes all schemas', async () => {
      const raw = await ragIndexTool.invoke({ reindex: true })
      const result = typeof raw === 'string' ? JSON.parse(raw) : raw
      expect(result.success).toBe(true)
      expect((result.data as Record<string, unknown>).total).toBe(5)
      expect((result.data as Record<string, unknown>).created).toBe(3)
      expect(result.summary).toContain('全量重建完成')
    })
  })
})
