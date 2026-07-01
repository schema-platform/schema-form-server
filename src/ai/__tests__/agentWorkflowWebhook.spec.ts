/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  normalizeWebhookPath,
  matchWebhookNode,
  buildWebhookSignaturePayload,
  verifyWebhookHmac,
  ensureWebhookSecretsInGraph,
} from '../services/agentWorkflowWebhookUtils.js'

describe('agentWorkflowWebhookUtils', () => {
  it('normalizes webhook paths', () => {
    expect(normalizeWebhookPath('/hook')).toBe('/hook')
    expect(normalizeWebhookPath('hook')).toBe('/hook')
    expect(normalizeWebhookPath('')).toBe('/')
  })

  it('matches webhook node by path and method', () => {
    const graph = {
      entryNodeId: 'webhook-1',
      nodes: [
        {
          id: 'webhook-1',
          type: 'webhook-trigger',
          data: { webhookPath: '/document-summary', webhookMethod: 'POST', webhookSecret: 'abc' },
        },
      ],
    }
    const match = matchWebhookNode(graph, '/document-summary', 'POST')
    expect(match?.nodeId).toBe('webhook-1')
    expect(match?.webhookSecret).toBe('abc')
    expect(matchWebhookNode(graph, '/document-summary', 'GET')).toBeNull()
  })

  it('verifies HMAC signature', () => {
    const secret = 'test-secret'
    const body = JSON.stringify({ documentId: 'x' })
    const sig = createHmac('sha256', secret).update(body).digest('hex')
    expect(verifyWebhookHmac(secret, `sha256=${sig}`, body)).toBe(true)
    expect(verifyWebhookHmac(secret, sig, body)).toBe(true)
    expect(verifyWebhookHmac(secret, 'sha256=deadbeef', body)).toBe(false)
  })

  it('builds GET payload from query', () => {
    const payload = buildWebhookSignaturePayload('GET', {}, { a: '1' })
    expect(payload).toBe('{"a":"1"}')
  })

  it('injects webhook secrets on publish graph', () => {
    const graph = {
      nodes: [{ id: 'w1', type: 'webhook-trigger', data: { webhookPath: '/x' } }],
    }
    const next = ensureWebhookSecretsInGraph(graph)
    const secret = (next.nodes as Array<{ data: { webhookSecret?: string } }>)[0].data.webhookSecret
    expect(secret).toMatch(/^[a-f0-9]{64}$/)
  })
})
