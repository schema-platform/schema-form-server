/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { chatRequestSchema, publishRequestSchema } from '../schemas/aiSchemas.js'

describe('chatRequestSchema', () => {
  const validRequest = {
    message: '生成一个用户注册表单',
    context: { source: 'standalone' },
  }

  it('accepts valid request', () => {
    const result = chatRequestSchema.safeParse(validRequest)
    expect(result.success).toBe(true)
  })

  it('accepts with optional conversationId', () => {
    const result = chatRequestSchema.safeParse({
      ...validRequest,
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
  })

  it('accepts with all context fields', () => {
    const result = chatRequestSchema.safeParse({
      message: '修改这个表单',
      context: {
        source: 'editor',
        schemaId: '550e8400-e29b-41d4-a716-446655440000',
        flowId: '550e8400-e29b-41d4-a716-446655440001',
        nodeId: 'node-1',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty message', () => {
    const result = chatRequestSchema.safeParse({ ...validRequest, message: '' })
    expect(result.success).toBe(false)
  })

  it('rejects message over 10000 chars', () => {
    const result = chatRequestSchema.safeParse({
      ...validRequest,
      message: 'x'.repeat(10001),
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing context', () => {
    const result = chatRequestSchema.safeParse({ message: 'hello' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid source', () => {
    const result = chatRequestSchema.safeParse({
      message: 'hello',
      context: { source: 'invalid' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid conversationId format', () => {
    const result = chatRequestSchema.safeParse({
      ...validRequest,
      conversationId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('rejects extra fields (strict mode)', () => {
    const result = chatRequestSchema.safeParse({
      ...validRequest,
      unknownField: 'test',
    })
    expect(result.success).toBe(false)
  })
})

describe('publishRequestSchema', () => {
  const validPublish = {
    conversationId: '550e8400-e29b-41d4-a716-446655440000',
    type: 'schema' as const,
    payload: [{ id: '550e8400-e29b-41d4-a716-446655440002', type: 'input' }],
  }

  it('accepts valid schema publish', () => {
    const result = publishRequestSchema.safeParse(validPublish)
    expect(result.success).toBe(true)
  })

  it('accepts valid flow publish', () => {
    const result = publishRequestSchema.safeParse({
      ...validPublish,
      type: 'flow',
      payload: { nodes: [], edges: [] },
    })
    expect(result.success).toBe(true)
  })

  it('accepts with target', () => {
    const result = publishRequestSchema.safeParse({
      ...validPublish,
      target: { type: 'flow_node', flowId: 'f1', nodeId: 'n1' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing conversationId', () => {
    const result = publishRequestSchema.safeParse({
      type: 'schema',
      payload: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid type', () => {
    const result = publishRequestSchema.safeParse({
      ...validPublish,
      type: 'invalid',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing payload', () => {
    const result = publishRequestSchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      type: 'schema',
    })
    expect(result.success).toBe(false)
  })

  it('rejects target with missing fields', () => {
    const result = publishRequestSchema.safeParse({
      ...validPublish,
      target: { type: 'flow_node' },
    })
    expect(result.success).toBe(false)
  })
})
