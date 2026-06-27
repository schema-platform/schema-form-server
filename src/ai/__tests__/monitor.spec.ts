/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid'),
}))

vi.mock('../models/monitor.js', () => ({
  AgentMetricModel: {
    create: vi.fn().mockResolvedValue({ _id: 'mock-uuid' }),
  },
}))

import { executeWithMetrics, withAgentMetrics } from '../graph/agentBase.js'

describe('executeWithMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records successful execution', async () => {
    const mockFn = vi.fn().mockResolvedValue('result')

    const result = await executeWithMetrics('editor', 'invoke', mockFn)

    expect(result).toBe('result')
    expect(mockFn).toHaveBeenCalledOnce()
  })

  it('records failed execution and rethrows error', async () => {
    const error = new Error('Test error')
    const mockFn = vi.fn().mockRejectedValue(error)

    await expect(executeWithMetrics('editor', 'invoke', mockFn)).rejects.toThrow('Test error')
    expect(mockFn).toHaveBeenCalledOnce()
  })

  it('extracts token usage from response', async () => {
    const mockResponse = {
      content: 'response',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    }
    const mockFn = vi.fn().mockResolvedValue(mockResponse)

    const result = await executeWithMetrics('editor', 'invoke', mockFn)

    expect(result).toBe(mockResponse)
  })

  it('handles response without usage', async () => {
    const mockResponse = { content: 'response' }
    const mockFn = vi.fn().mockResolvedValue(mockResponse)

    const result = await executeWithMetrics('editor', 'invoke', mockFn)

    expect(result).toBe(mockResponse)
  })

  it('includes metadata in metric', async () => {
    const mockFn = vi.fn().mockResolvedValue('result')
    const metadata = { conversationId: 'conv-123', taskType: 'generate_simple' }

    await executeWithMetrics('editor', 'invoke', mockFn, metadata)

    expect(mockFn).toHaveBeenCalled()
  })
})

describe('withAgentMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wraps agent node function with metrics', async () => {
    const mockNode = vi.fn().mockResolvedValue({ messages: [] })
    const state = {
      sessionId: 'session-123',
      taskType: 'generate_simple',
      messages: [],
    }

    const wrappedNode = withAgentMetrics('editor', 'invoke', mockNode)
    const result = await wrappedNode(state)

    expect(result).toEqual({ messages: [] })
    expect(mockNode).toHaveBeenCalledWith(state)
  })

  it('preserves agent node signature', async () => {
    const mockNode = vi.fn().mockResolvedValue({ currentAgent: 'editor' })
    const state = { sessionId: 'test' }

    const wrappedNode = withAgentMetrics('thinker', 'think', mockNode)
    const result = await wrappedNode(state)

    expect(result).toEqual({ currentAgent: 'editor' })
  })

  it('handles node errors correctly', async () => {
    const error = new Error('Node failed')
    const mockNode = vi.fn().mockRejectedValue(error)
    const state = { sessionId: 'test' }

    const wrappedNode = withAgentMetrics('editor', 'invoke', mockNode)

    await expect(wrappedNode(state)).rejects.toThrow('Node failed')
  })
})
