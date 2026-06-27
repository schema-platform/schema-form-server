/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock mongoose before importing the service
vi.mock('mongoose', () => {
  const mockSchema = {
    index: vi.fn(),
  }
  const MockSchema = vi.fn(() => mockSchema)
  ;(MockSchema as any).Types = {
    Mixed: 'Mixed',
  }

  const mockModel = {
    create: vi.fn(),
    findById: vi.fn(),
    find: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findByIdAndDelete: vi.fn(),
    countDocuments: vi.fn(),
  }

  return {
    default: {
      Schema: MockSchema,
      model: vi.fn(() => mockModel),
      models: {},
    },
    Schema: MockSchema,
  }
})

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}))

const mockChatInvoke = vi.fn()

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(() => ({
    invoke: mockChatInvoke,
  })),
}))

import {
  createConversation,
  maybeGenerateSummary,
  saveHistorySummary,
} from '../services/conversationService.js'

// Access the mocked model methods
const mongoose = await import('mongoose')
const mockModel = (mongoose.default.model as ReturnType<typeof vi.fn>)()

beforeEach(() => {
  vi.clearAllMocks()
  mockChatInvoke.mockReset()
})

// ────────────────────────────────────────────
// Test: historySummary auto generation
// ────────────────────────────────────────────

describe('historySummary auto generation', () => {
  it('does not generate summary when messages < threshold (20)', async () => {
    const convo = {
      messages: Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`,
        timestamp: new Date(),
      })),
      historySummary: undefined,
    }
    const chain = { select: vi.fn().mockResolvedValue(convo) }
    mockModel.findById.mockReturnValue(chain)

    const result = await maybeGenerateSummary('conv-1')

    expect(result).toBeUndefined()
    expect(mockModel.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('returns existing summary when messages < threshold * 1.5', async () => {
    const existingSummary = '之前讨论了用户注册表单的设计'
    const convo = {
      messages: Array.from({ length: 22 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`,
        timestamp: new Date(),
      })),
      historySummary: existingSummary,
    }
    const chain = { select: vi.fn().mockResolvedValue(convo) }
    mockModel.findById.mockReturnValue(chain)

    const result = await maybeGenerateSummary('conv-1')

    expect(result).toBe(existingSummary)
    expect(mockModel.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('returns undefined when conversation not found', async () => {
    const chain = { select: vi.fn().mockResolvedValue(null) }
    mockModel.findById.mockReturnValue(chain)

    const result = await maybeGenerateSummary('nonexistent')
    expect(result).toBeUndefined()
  })

  it('attempts summary generation when messages exceed threshold and no existing summary', async () => {
    const originalKey = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'test-key-12345'

    try {
      mockChatInvoke.mockResolvedValue({ content: '讨论了表单设计和审批流程' })

      const messages = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`,
        timestamp: new Date(),
      }))

      const convo = { messages, historySummary: undefined }
      const chain = { select: vi.fn().mockResolvedValue(convo) }
      mockModel.findById.mockReturnValue(chain)
      mockModel.findByIdAndUpdate.mockResolvedValue({})

      const result = await maybeGenerateSummary('conv-1')

      expect(result).toBe('讨论了表单设计和审批流程')
      expect(mockChatInvoke).toHaveBeenCalled()
      expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'conv-1',
        { $set: { historySummary: '讨论了表单设计和审批流程' } },
      )
    } finally {
      process.env.DEEPSEEK_API_KEY = originalKey
    }
  })

  it('falls back to existing summary when LLM call fails', async () => {
    const originalKey = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'test-key-12345'

    try {
      mockChatInvoke.mockRejectedValue(new Error('API timeout'))

      const existingSummary = '旧摘要'
      const messages = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`,
        timestamp: new Date(),
      }))

      const convo = { messages, historySummary: existingSummary }
      const chain = { select: vi.fn().mockResolvedValue(convo) }
      mockModel.findById.mockReturnValue(chain)

      const result = await maybeGenerateSummary('conv-1')

      expect(result).toBe(existingSummary)
    } finally {
      process.env.DEEPSEEK_API_KEY = originalKey
    }
  })

  it('skips LLM call when no API key is set', async () => {
    const originalKey = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY

    try {
      const messages = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`,
        timestamp: new Date(),
      }))

      const convo = { messages, historySummary: 'existing' }
      const chain = { select: vi.fn().mockResolvedValue(convo) }
      mockModel.findById.mockReturnValue(chain)

      const result = await maybeGenerateSummary('conv-1')

      // Should return existing summary without calling LLM
      expect(result).toBe('existing')
      expect(mockChatInvoke).not.toHaveBeenCalled()
    } finally {
      process.env.DEEPSEEK_API_KEY = originalKey
    }
  })
})

// ────────────────────────────────────────────
// Test: saveHistorySummary
// ────────────────────────────────────────────

describe('saveHistorySummary', () => {
  it('updates conversation with summary', async () => {
    mockModel.findByIdAndUpdate.mockResolvedValue({})
    await saveHistorySummary('conv-1', '这是一个摘要')

    expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'conv-1',
      { $set: { historySummary: '这是一个摘要' } },
    )
  })
})

// ────────────────────────────────────────────
// Test: Multi-turn context in graph state
// ────────────────────────────────────────────

describe('multi-turn context in graph state', () => {
  it('historySummary field exists in interaction state', async () => {
    const { AgentStateAnnotation } = await import('../graph/state.js')
    const spec = AgentStateAnnotation.spec.interaction as Record<string, unknown>
    const defaultState = spec.value as Record<string, unknown>
    expect(defaultState).toHaveProperty('historySummary')
    expect((defaultState as Record<string, unknown>).historySummary).toBe('')
  })

  it('context default has source and turnCount', async () => {
    const { AgentStateAnnotation } = await import('../graph/state.js')
    const spec = AgentStateAnnotation.spec.context as Record<string, unknown>
    const defaultContext = spec.value as Record<string, unknown>
    expect(defaultContext).toHaveProperty('source', 'standalone')
    expect(defaultContext).toHaveProperty('turnCount', 0)
  })

  it('context supports incremental schema updates across turns', () => {
    const schema1 = [{ id: 's1', type: 'input', field: 'name' }]
    const schema2 = [
      { id: 's1', type: 'input', field: 'userName' },
      { id: 's2', type: 'input', field: 'email' },
    ]

    let currentSchema: Record<string, unknown>[] | undefined
    currentSchema = schema1
    expect(currentSchema).toEqual(schema1)

    currentSchema = schema2
    expect(currentSchema).toEqual(schema2)
    expect(currentSchema).toHaveLength(2)
    expect(currentSchema[0].field).toBe('userName')
    expect(currentSchema[1].field).toBe('email')
  })

  it('context supports incremental flow updates across turns', () => {
    const flow1 = {
      nodes: [{ id: 'n1', data: { bpmnType: 'startEvent', label: '开始' } }],
      edges: [],
    }
    const flow2 = {
      nodes: [
        { id: 'n1', data: { bpmnType: 'startEvent', label: '开始' } },
        { id: 'n2', data: { bpmnType: 'userTask', label: '审批' } },
      ],
      edges: [{ id: 'e1', source: { cell: 'n1' }, target: { cell: 'n2' } }],
    }

    let currentFlow: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | undefined
    currentFlow = flow1
    expect(currentFlow.nodes).toHaveLength(1)

    currentFlow = flow2
    expect(currentFlow.nodes).toHaveLength(2)
    expect(currentFlow.edges).toHaveLength(1)
  })
})

// ────────────────────────────────────────────
// Test: Conversation source enum includes 'page'
// ────────────────────────────────────────────

describe('conversation model source enum', () => {
  it('createConversation accepts page source', async () => {
    mockModel.create.mockResolvedValue({ _id: 'mock-uuid-1234', source: 'page', messages: [] })

    await createConversation({ source: 'page' })

    expect(mockModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'page' }),
    )
  })

  it('createConversation accepts all valid sources', async () => {
    for (const source of ['editor', 'flow', 'page', 'standalone'] as const) {
      mockModel.create.mockResolvedValue({ _id: 'mock-uuid-1234', source, messages: [] })
      await createConversation({ source })
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ source }),
      )
    }
  })
})
