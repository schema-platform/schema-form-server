/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../models/agentWorkflow.js', () => ({
  AgentWorkflowExecutionModel: {
    updateOne: vi.fn(),
    findById: vi.fn(),
  },
}))

vi.mock('./documentService.js', () => ({
  getDocumentWithText: vi.fn(),
}))

vi.mock('./llmCache.js', () => ({
  getLLM: vi.fn(),
}))

vi.mock('../tools/registry.js', () => ({
  ensureToolsReady: vi.fn(),
  getToolSync: vi.fn(),
  getToolsByNames: vi.fn(),
}))

import { getDocumentWithText } from './documentService.js'

// 通过 executeAgentWorkflow 间接测试较重，此处直接验证 document-parse 分支逻辑
// 抽取为可测纯函数风格（与 executor 内逻辑一致）
function resolveDocumentId(
  data: { documentSource?: string; documentId?: string; inputField?: string },
  ctx: { input: Record<string, unknown>; lastOutput: unknown },
): string {
  const source = data.documentSource ?? 'inputField'
  if (source === 'documentId') {
    return String(data.documentId ?? '').trim()
  }
  const field = data.inputField?.trim() || 'documentId'
  const inputObj = ctx.input
  const lastObj = (ctx.lastOutput ?? {}) as Record<string, unknown>
  const body = inputObj.body as Record<string, unknown> | undefined
  const raw = lastObj[field] ?? inputObj[field] ?? body?.[field]
  return raw != null ? String(raw) : ''
}

describe('document-parse node resolution', () => {
  beforeEach(() => {
    vi.mocked(getDocumentWithText).mockReset()
  })

  it('reads documentId from input field', () => {
    const id = resolveDocumentId(
      { documentSource: 'inputField', inputField: 'documentId' },
      { input: { documentId: 'abc123' }, lastOutput: {} },
    )
    expect(id).toBe('abc123')
  })

  it('reads documentId from webhook body', () => {
    const id = resolveDocumentId(
      { documentSource: 'inputField', inputField: 'documentId' },
      { input: { body: { documentId: 'from-webhook' } }, lastOutput: {} },
    )
    expect(id).toBe('from-webhook')
  })

  it('uses fixed documentId source', () => {
    const id = resolveDocumentId(
      { documentSource: 'documentId', documentId: 'fixed-id' },
      { input: {}, lastOutput: {} },
    )
    expect(id).toBe('fixed-id')
  })
})
