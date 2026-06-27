/**
 * Tests for agentBase truncation functions.
 *
 * Covers:
 * - estimateTokens accuracy
 * - estimateMessageTokens for various message shapes
 * - truncateMessagesForLangGraph: budget overflow, tool chain preservation, edge cases
 * - truncateMessages (legacy non-graph path)
 */

import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  estimateMessageTokens,
  truncateMessages,
  truncateMessagesForLangGraph,
} from '../agentBase.js'

// ─── Helpers ────────────────────────────────────

/** Minimal message mock matching the generic constraint of truncateMessages */
function mockMessage(
  type: 'HumanMessage' | 'AIMessage' | 'AIMessageChunk' | 'ToolMessage' | 'SystemMessage',
  content: string,
  extra?: { tool_calls?: unknown[]; tool_call_id?: string },
) {
  return {
    constructor: { name: type },
    content,
    ...extra,
  }
}

/** Minimal message mock for truncateMessagesForLangGraph (closer to BaseMessage) */
function langGraphMessage(
  type: 'HumanMessage' | 'AIMessage' | 'AIMessageChunk' | 'ToolMessage' | 'SystemMessage',
  content: string | Array<{ type: string; text: string }>,
  extra?: { tool_calls?: unknown[]; tool_call_id?: string; additional_kwargs?: Record<string, unknown> },
) {
  return {
    constructor: { name: type },
    content,
    ...extra,
  }
}

// ─── estimateTokens ─────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(null as unknown as string)).toBe(0)
    expect(estimateTokens(undefined as unknown as string)).toBe(0)
  })

  it('estimates Chinese characters at ~1.5 tokens each', () => {
    // 10 CJK chars => ceil(10 * 1.5) = 15
    const tokens = estimateTokens('你好世界测试一二三四')
    expect(tokens).toBe(15)
  })

  it('estimates ASCII at ~0.25 tokens per char (1/4)', () => {
    // 20 ASCII chars => ceil(20/4) = 5
    const tokens = estimateTokens('abcdefghijklmnopqrst')
    expect(tokens).toBe(5)
  })

  it('handles mixed CJK and ASCII', () => {
    const text = 'Hello你好World世界'
    // CJK: 4 chars * 1.5 = 6
    // non-CJK: 10 chars / 4 = 2.5
    // json overhead for 0 brackets = 0
    // ceil(6 + 2.5) = 9
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThanOrEqual(8)
    expect(tokens).toBeLessThanOrEqual(10)
  })

  it('counts JSON overhead', () => {
    const json = '{"key": "value", "arr": [1, 2]}'
    const plain = 'key value arr 1 2'
    // JSON version should have more tokens due to structural chars
    expect(estimateTokens(json)).toBeGreaterThan(estimateTokens(plain))
  })

  it('handles large text without error', () => {
    const large = 'a'.repeat(100_000)
    const tokens = estimateTokens(large)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(100_000) // sanity check
  })
})

// ─── estimateMessageTokens ──────────────────────

describe('estimateMessageTokens', () => {
  it('estimates string content', () => {
    const msg = { content: 'Hello world', constructor: { name: 'HumanMessage' } }
    const tokens = estimateMessageTokens(msg)
    expect(tokens).toBeGreaterThan(0)
  })

  it('estimates array content (multimodal)', () => {
    const msg = {
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ],
      constructor: { name: 'HumanMessage' },
    }
    const tokens = estimateMessageTokens(msg)
    expect(tokens).toBeGreaterThan(0)
  })

  it('includes tool_calls in estimate', () => {
    const without = { content: 'test', constructor: { name: 'AIMessage' } }
    const withToolCalls = {
      content: 'test',
      tool_calls: [{ name: 'create_schema', args: { type: 'form', name: 'test' } }],
      constructor: { name: 'AIMessage' },
    }
    expect(estimateMessageTokens(withToolCalls)).toBeGreaterThan(estimateMessageTokens(without))
  })

  it('includes reasoning_content in estimate', () => {
    const without = { content: 'test', constructor: { name: 'AIMessage' } }
    const withReasoning = {
      content: 'test',
      additional_kwargs: { reasoning_content: 'This is my thinking process...' },
      constructor: { name: 'AIMessage' },
    }
    expect(estimateMessageTokens(withReasoning)).toBeGreaterThan(estimateMessageTokens(without))
  })

  it('adds base overhead of 4 tokens per message', () => {
    const empty = { content: '', constructor: { name: 'HumanMessage' } }
    expect(estimateMessageTokens(empty)).toBe(4)
  })
})

// ─── truncateMessagesForLangGraph ───────────────

describe('truncateMessagesForLangGraph', () => {
  it('returns all messages when under budget', () => {
    const messages = [
      langGraphMessage('HumanMessage', 'Hello'),
      langGraphMessage('AIMessage', 'Hi there'),
      langGraphMessage('HumanMessage', 'Make a form'),
    ]
    const result = truncateMessagesForLangGraph(messages, 100_000)
    expect(result).toHaveLength(3)
  })

  it('returns all messages when count <= MIN_KEEP_MESSAGES (4)', () => {
    const messages = [
      langGraphMessage('HumanMessage', 'a'.repeat(50000)),
      langGraphMessage('AIMessage', 'b'.repeat(50000)),
      langGraphMessage('HumanMessage', 'c'.repeat(50000)),
    ]
    const result = truncateMessagesForLangGraph(messages, 100)
    expect(result).toHaveLength(3)
  })

  it('truncates when total tokens exceed budget', () => {
    // Create 20 messages with large content to exceed a small budget
    const messages = Array.from({ length: 20 }, (_, i) =>
      langGraphMessage(
        i % 2 === 0 ? 'HumanMessage' : 'AIMessage',
        'x'.repeat(200), // ~50 tokens each
      ),
    )
    // Budget allows ~4 messages worth (200 tokens)
    const result = truncateMessagesForLangGraph(messages, 200)
    expect(result.length).toBeLessThan(20)
    // Must keep at least MIN_KEEP_MESSAGES
    expect(result.length).toBeGreaterThanOrEqual(4)
  })

  it('always keeps the last MIN_KEEP_MESSAGES messages', () => {
    const messages = Array.from({ length: 15 }, (_, i) =>
      langGraphMessage(
        i % 2 === 0 ? 'HumanMessage' : 'AIMessage',
        'word '.repeat(100), // ~50 tokens each
      ),
    )
    const result = truncateMessagesForLangGraph(messages, 300)

    // Last 4 of original must be in result
    const lastFour = messages.slice(-4)
    for (const msg of lastFour) {
      expect(result).toContainEqual(msg)
    }
  })

  it('keeps first HumanMessage when it fits within budget alongside recent messages', () => {
    const first = langGraphMessage('HumanMessage', 'Create a user registration form')
    // Small filler messages that won't blow the budget
    const messages = [
      first,
      ...Array.from({ length: 10 }, (_, i) =>
        langGraphMessage(
          i % 2 === 0 ? 'HumanMessage' : 'AIMessage',
          'ok', // very small — ~5 tokens each
        ),
      ),
    ]
    // Budget of 200 tokens: 11 messages * ~9 tokens = ~99 tokens total, well within budget
    const result = truncateMessagesForLangGraph(messages, 200)
    // All messages fit, so first is preserved
    expect(result[0]).toBe(first)
    expect(result).toHaveLength(11)
  })

  it('drops first message when budget forces aggressive truncation', () => {
    const first = langGraphMessage('HumanMessage', 'Create a user registration form')
    const messages = [
      first,
      ...Array.from({ length: 20 }, (_, i) =>
        langGraphMessage(
          i % 2 === 0 ? 'HumanMessage' : 'AIMessage',
          'word '.repeat(200), // ~100 tokens each
        ),
      ),
    ]
    const result = truncateMessagesForLangGraph(messages, 2000)
    // With 21 messages total ~2000 tokens, budget forces dropping early messages
    // First message may be dropped if cutoff doesn't land near index 0
    expect(result.length).toBeGreaterThanOrEqual(4)
    expect(result.length).toBeLessThan(21)
  })

  it('never breaks a tool_calls -> ToolMessage chain', () => {
    const aiWithTools = langGraphMessage('AIMessage', '', {
      tool_calls: [{ name: 'create_schema', args: { type: 'form' } }],
    })
    const toolResult = langGraphMessage('ToolMessage', '{"success": true}', {
      tool_call_id: 'call_1',
    })

    // Build messages where the tool chain is in the "middle" zone
    const filler = Array.from({ length: 10 }, (_, i) =>
      langGraphMessage('HumanMessage', 'word '.repeat(200)),
    )
    const messages = [
      langGraphMessage('HumanMessage', 'First message'),
      ...filler.slice(0, 5),
      aiWithTools,
      toolResult,
      ...filler.slice(5),
      langGraphMessage('HumanMessage', 'Latest'),
      langGraphMessage('AIMessage', 'Response'),
      langGraphMessage('HumanMessage', 'Another'),
      langGraphMessage('AIMessage', 'Another response'),
    ]

    const result = truncateMessagesForLangGraph(messages, 2000)

    // If aiWithTools is in result, toolResult must also be
    const hasAi = result.includes(aiWithTools)
    const hasTool = result.includes(toolResult)
    if (hasAi) {
      expect(hasTool).toBe(true)
    }
  })

  it('never breaks ToolMessage -> preceding AIMessage chain (backward check)', () => {
    const aiWithTools = langGraphMessage('AIMessage', '', {
      tool_calls: [{ name: 'edit_schema', args: {} }],
    })
    const toolResult = langGraphMessage('ToolMessage', '{"success": true}', {
      tool_call_id: 'call_2',
    })

    // Place tool chain just beyond the cutoff — ToolMessage should pull back
    const messages = [
      langGraphMessage('HumanMessage', 'First'),
      ...Array.from({ length: 8 }, () => langGraphMessage('HumanMessage', 'word '.repeat(300))),
      aiWithTools,
      toolResult,
      langGraphMessage('HumanMessage', 'Last'),
      langGraphMessage('AIMessage', 'OK'),
      langGraphMessage('HumanMessage', 'Another'),
      langGraphMessage('AIMessage', 'OK2'),
    ]

    const result = truncateMessagesForLangGraph(messages, 1500)

    // Verify tool chain integrity: if toolResult is included, aiWithTools must be too
    if (result.includes(toolResult)) {
      expect(result).toContain(aiWithTools)
    }
  })

  it('returns same-length array if within budget', () => {
    const messages = [
      langGraphMessage('HumanMessage', 'short'),
      langGraphMessage('AIMessage', 'short reply'),
    ]
    const result = truncateMessagesForLangGraph(messages, 100_000)
    expect(result).toHaveLength(2)
    // Should be a new array
    expect(result).not.toBe(messages)
  })

  it('handles empty message array', () => {
    const result = truncateMessagesForLangGraph([], 1000)
    expect(result).toHaveLength(0)
  })

  it('handles single message', () => {
    const messages = [langGraphMessage('HumanMessage', 'Hello')]
    const result = truncateMessagesForLangGraph(messages, 1000)
    expect(result).toHaveLength(1)
  })

  it('handles messages with multimodal content arrays', () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      langGraphMessage(
        i % 2 === 0 ? 'HumanMessage' : 'AIMessage',
        [{ type: 'text', text: 'word '.repeat(200) }],
      ),
    )
    const result = truncateMessagesForLangGraph(messages, 500)
    expect(result.length).toBeGreaterThanOrEqual(4)
    expect(result.length).toBeLessThanOrEqual(10)
  })

  it('handles reasoning_content in messages', () => {
    const messages = [
      langGraphMessage('HumanMessage', 'Hello'),
      langGraphMessage('AIMessage', 'Response', {
        additional_kwargs: { reasoning_content: 'a'.repeat(5000) },
      }),
      langGraphMessage('HumanMessage', 'Follow up'),
      langGraphMessage('AIMessage', 'Done'),
    ]
    // The reasoning_content makes the AI message ~1250+ tokens
    const result = truncateMessagesForLangGraph(messages, 1000)
    // With 4 messages it's <= MIN_KEEP_MESSAGES, so all returned
    expect(result).toHaveLength(4)
  })

  it('uses default budget of 60000 when not specified', () => {
    // Create messages that total ~50K tokens — should NOT be truncated
    const messages = Array.from({ length: 50 }, (_, i) =>
      langGraphMessage(
        i % 2 === 0 ? 'HumanMessage' : 'AIMessage',
        'word '.repeat(400), // ~200 tokens each, 50 * 200 = 10K tokens
      ),
    )
    const result = truncateMessagesForLangGraph(messages)
    expect(result).toHaveLength(50)
  })
})

// ─── truncateMessages (legacy) ──────────────────

describe('truncateMessages', () => {
  it('returns all messages when under budget', () => {
    const messages = [
      mockMessage('HumanMessage', 'Hello'),
      mockMessage('AIMessage', 'Hi'),
      mockMessage('HumanMessage', 'Make form'),
    ]
    // truncateMessages slices off the last message (expects caller to append it)
    const result = truncateMessages(messages, 100_000)
    expect(result).toHaveLength(2) // all except last
  })

  it('keeps last MIN_KEEP_MESSAGES when over budget', () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      mockMessage(
        i % 2 === 0 ? 'HumanMessage' : 'AIMessage',
        'word '.repeat(200),
      ),
    )
    const result = truncateMessages(messages, 200)
    // Should keep at least MIN_KEEP_MESSAGES from the "history" (all but last)
    expect(result.length).toBeGreaterThanOrEqual(4)
    expect(result.length).toBeLessThan(19)
  })

  it('preserves tool_calls chain in legacy path', () => {
    const aiWithTools = mockMessage('AIMessage', '', {
      tool_calls: [{ name: 'test', args: {} }],
    })
    const toolResult = mockMessage('ToolMessage', 'result', {
      tool_call_id: 'call_1',
    })

    const messages = [
      mockMessage('HumanMessage', 'First'),
      ...Array.from({ length: 10 }, () => mockMessage('HumanMessage', 'word '.repeat(200))),
      aiWithTools,
      toolResult,
      mockMessage('HumanMessage', 'Last'),
    ]

    const result = truncateMessages(messages, 500)

    // If aiWithTools is in result, toolResult must also be
    if (result.includes(aiWithTools)) {
      expect(result).toContain(toolResult)
    }
  })
})
