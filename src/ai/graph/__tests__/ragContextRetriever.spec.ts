/**
 * Tests for RAG context retriever.
 *
 * Covers:
 * - formatRagContext: output format, empty results, multiple results
 * - retrieveRagContext: short message skip, error handling, integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatRagContext, retrieveRagContext } from '../ragContextRetriever.js'
import type { SearchResult } from '../../services/ragService.js'

// Mock the semanticSearch function
vi.mock('../../services/ragService.js', () => ({
  semanticSearch: vi.fn(),
}))

// Mock the logger
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { semanticSearch } from '../../services/ragService.js'

const mockSemanticSearch = vi.mocked(semanticSearch)

// ─── Test data ──────────────────────────────────

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    schemaId: 'schema-001',
    editId: 'edit-001',
    name: '用户信息表单',
    type: 'form',
    score: 85,
    metadata: {
      widgetTypes: ['input', 'select', 'table'],
      fieldNames: ['userName', 'phone', 'email'],
      labels: ['姓名', '手机', '邮箱'],
      description: '包含 3 种组件类型，字段包括 姓名、手机、邮箱',
    },
    ...overrides,
  }
}

// ─── formatRagContext ────────────────────────────

describe('formatRagContext', () => {
  it('returns empty string for empty results', () => {
    expect(formatRagContext([])).toBe('')
  })

  it('formats a single result correctly', () => {
    const results = [makeSearchResult()]
    const context = formatRagContext(results)

    expect(context).toContain('## 参考 Schema')
    expect(context).toContain('用户信息表单')
    expect(context).toContain('表单')
    expect(context).toContain('85%')
    expect(context).toContain('input, select, table')
    expect(context).toContain('userName, phone, email')
    expect(context).toContain('get_schema_detail')
  })

  it('formats multiple results with correct numbering', () => {
    const results = [
      makeSearchResult({ name: '表单A', score: 90, schemaId: 's1' }),
      makeSearchResult({ name: '表单B', score: 75, schemaId: 's2' }),
      makeSearchResult({ name: '表单C', score: 60, schemaId: 's3' }),
    ]
    const context = formatRagContext(results)

    expect(context).toContain('1. **表单A**')
    expect(context).toContain('2. **表单B**')
    expect(context).toContain('3. **表单C**')
    expect(context).toContain('90%')
    expect(context).toContain('75%')
    expect(context).toContain('60%')
  })

  it('shows search_list type label correctly', () => {
    const results = [makeSearchResult({ type: 'search_list' })]
    const context = formatRagContext(results)

    expect(context).toContain('搜索列表')
    expect(context).not.toContain('form')
  })

  it('handles empty metadata gracefully', () => {
    const results = [makeSearchResult({
      metadata: {
        widgetTypes: [],
        fieldNames: [],
        labels: [],
        description: '',
      },
    })]
    const context = formatRagContext(results)

    expect(context).toContain('组件类型：无')
    expect(context).toContain('关键字段：无')
    expect(context).toContain('描述：无描述')
  })

  it('truncates field names to 8 items', () => {
    const results = [makeSearchResult({
      metadata: {
        widgetTypes: ['input'],
        fieldNames: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10'],
        labels: [],
        description: 'test',
      },
    })]
    const context = formatRagContext(results)

    expect(context).toContain('f1, f2, f3, f4, f5, f6, f7, f8')
    expect(context).not.toContain('f9')
    expect(context).not.toContain('f10')
  })
})

// ─── retrieveRagContext ──────────────────────────

describe('retrieveRagContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips retrieval for very short messages (< 4 chars)', async () => {
    const result = await retrieveRagContext('hi')

    expect(result.context).toBe('')
    expect(result.results).toEqual([])
    expect(mockSemanticSearch).not.toHaveBeenCalled()
  })

  it('skips retrieval for empty/whitespace messages', async () => {
    const result = await retrieveRagContext('   ')

    expect(result.context).toBe('')
    expect(result.results).toEqual([])
    expect(mockSemanticSearch).not.toHaveBeenCalled()
  })

  it('calls semanticSearch with correct parameters', async () => {
    mockSemanticSearch.mockResolvedValue([])

    await retrieveRagContext('创建一个用户管理表单', { topK: 5, minScore: 20 })

    expect(mockSemanticSearch).toHaveBeenCalledWith('创建一个用户管理表单', {
      limit: 5,
      minScore: 20,
      type: undefined,
    })
  })

  it('uses default options when not specified', async () => {
    mockSemanticSearch.mockResolvedValue([])

    await retrieveRagContext('创建表单')

    expect(mockSemanticSearch).toHaveBeenCalledWith('创建表单', {
      limit: 3,
      minScore: 15,
      type: undefined,
    })
  })

  it('passes type filter when specified', async () => {
    mockSemanticSearch.mockResolvedValue([])

    await retrieveRagContext('搜索列表页', { type: 'search_list' })

    expect(mockSemanticSearch).toHaveBeenCalledWith('搜索列表页', {
      limit: 3,
      minScore: 15,
      type: 'search_list',
    })
  })

  it('returns formatted context when results are found', async () => {
    mockSemanticSearch.mockResolvedValue([
      makeSearchResult({ name: '请假表单', score: 88 }),
    ])

    const result = await retrieveRagContext('创建一个请假申请表单')

    expect(result.results).toHaveLength(1)
    expect(result.context).toContain('## 参考 Schema')
    expect(result.context).toContain('请假表单')
    expect(result.context).toContain('88%')
  })

  it('returns empty context when no results found', async () => {
    mockSemanticSearch.mockResolvedValue([])

    const result = await retrieveRagContext('完全无关的查询内容')

    expect(result.results).toEqual([])
    expect(result.context).toBe('')
  })

  it('returns empty context on error (graceful degradation)', async () => {
    mockSemanticSearch.mockRejectedValue(new Error('Embedding API timeout'))

    const result = await retrieveRagContext('创建表单')

    expect(result.context).toBe('')
    expect(result.results).toEqual([])
  })

  it('returns empty context on non-Error thrown', async () => {
    mockSemanticSearch.mockRejectedValue('string error')

    const result = await retrieveRagContext('创建表单')

    expect(result.context).toBe('')
    expect(result.results).toEqual([])
  })

  it('returns context for results with low scores filtered out', async () => {
    mockSemanticSearch.mockResolvedValue([])

    const result = await retrieveRagContext('审批流程', { minScore: 50 })

    expect(result.context).toBe('')
    expect(result.results).toEqual([])
  })
})
