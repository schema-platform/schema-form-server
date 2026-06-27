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

import {
  createConversation,
  getConversation,
  appendMessage,
  listConversations,
  deleteConversation,
  updateActiveAgent,
  getMessages,
} from '../services/conversationService.js'

// Access the mocked model methods
const mongoose = await import('mongoose')
const mockModel = (mongoose.default.model as ReturnType<typeof vi.fn>)()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createConversation', () => {
  it('creates a conversation with correct params', async () => {
    const mockConvo = { _id: 'mock-uuid-1234', source: 'standalone', messages: [] }
    mockModel.create.mockResolvedValue(mockConvo)

    const result = await createConversation({ source: 'standalone' })

    expect(mockModel.create).toHaveBeenCalledWith({
      _id: 'mock-uuid-1234',
      source: 'standalone',
      schemaId: undefined,
      flowId: undefined,
      nodeId: undefined,
      messages: [],
      activeAgent: 'router',
    })
    expect(result).toEqual(mockConvo)
  })

  it('passes optional ids', async () => {
    mockModel.create.mockResolvedValue({})

    await createConversation({
      source: 'editor',
      schemaId: 'schema-1',
      flowId: 'flow-1',
      nodeId: 'node-1',
    })

    expect(mockModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'editor',
        schemaId: 'schema-1',
        flowId: 'flow-1',
        nodeId: 'node-1',
      }),
    )
  })
})

describe('getConversation', () => {
  it('finds by id', async () => {
    const mockConvo = { _id: 'conv-1' }
    mockModel.findById.mockResolvedValue(mockConvo)

    const result = await getConversation('conv-1')
    expect(mockModel.findById).toHaveBeenCalledWith('conv-1')
    expect(result).toEqual(mockConvo)
  })

  it('returns null when not found', async () => {
    mockModel.findById.mockResolvedValue(null)
    const result = await getConversation('nonexistent')
    expect(result).toBeNull()
  })
})

describe('appendMessage', () => {
  it('pushes message to messages array', async () => {
    const message = { role: 'user' as const, content: 'hello', timestamp: new Date() }
    mockModel.findByIdAndUpdate.mockResolvedValue({ _id: 'conv-1' })

    await appendMessage('conv-1', message)

    expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'conv-1',
      { $push: { messages: expect.objectContaining({ role: 'user', content: 'hello' }) } },
      { new: true },
    )
  })
})

describe('listConversations', () => {
  it('returns sorted conversations', async () => {
    const convos = [{ _id: '1' }, { _id: '2' }]
    const chain = { sort: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(convos) }
    mockModel.find.mockReturnValue(chain)

    const result = await listConversations()

    expect(mockModel.find).toHaveBeenCalled()
    expect(chain.sort).toHaveBeenCalledWith({ updatedAt: -1 })
    expect(chain.limit).toHaveBeenCalledWith(50)
    expect(result).toEqual(convos)
  })
})

describe('deleteConversation', () => {
  it('returns true when deleted', async () => {
    mockModel.findByIdAndDelete.mockResolvedValue({ _id: 'conv-1' })
    const result = await deleteConversation('conv-1')
    expect(result).toBe(true)
  })

  it('returns false when not found', async () => {
    mockModel.findByIdAndDelete.mockResolvedValue(null)
    const result = await deleteConversation('nonexistent')
    expect(result).toBe(false)
  })
})

describe('updateActiveAgent', () => {
  it('sets active agent', async () => {
    mockModel.findByIdAndUpdate.mockResolvedValue({})
    await updateActiveAgent('conv-1', 'editor')
    expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'conv-1',
      { $set: { activeAgent: 'editor' } },
    )
  })
})

describe('getMessages', () => {
  it('returns mapped messages', async () => {
    const convo = {
      messages: [
        { role: 'user', content: 'hi', timestamp: new Date('2026-01-01') },
        { role: 'assistant', content: 'hello', schema: [{ id: '1' }], timestamp: new Date('2026-01-02') },
      ],
    }
    const chain = { select: vi.fn().mockResolvedValue(convo) }
    mockModel.findById.mockReturnValue(chain)

    const result = await getMessages('conv-1')

    expect(mockModel.findById).toHaveBeenCalledWith('conv-1')
    expect(chain.select).toHaveBeenCalledWith('messages')
    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('user')
    expect(result[1].schema).toEqual([{ id: '1' }])
  })

  it('returns empty array when conversation not found', async () => {
    const chain = { select: vi.fn().mockResolvedValue(null) }
    mockModel.findById.mockReturnValue(chain)

    const result = await getMessages('nonexistent')
    expect(result).toEqual([])
  })
})
