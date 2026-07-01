/**
 * Agent Workflow Webhook — 路径匹配与 HMAC 验签
 *
 * 与 BPMN `/api/webhooks/:id/trigger` 对齐：
 *   X-Webhook-Signature: sha256=<hmac_hex>
 *   HMAC-SHA256(secret, rawBody)
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'

interface WebhookGraphNode {
  id: string
  type: string
  data?: {
    webhookPath?: string
    webhookMethod?: string
    webhookSecret?: string
  }
}

interface WebhookGraph {
  entryNodeId?: string
  nodes?: WebhookGraphNode[]
}

export function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '/') return '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

export function matchWebhookNode(
  graph: WebhookGraph,
  path: string,
  method: string,
) {
  const normalizedPath = normalizeWebhookPath(path)
  const normalizedMethod = method.toUpperCase()

  for (const node of graph.nodes ?? []) {
    if (node.type !== 'webhook-trigger') continue
    const nodePath = normalizeWebhookPath(String(node.data?.webhookPath ?? '/hook'))
    const nodeMethod = String(node.data?.webhookMethod ?? 'POST').toUpperCase()
    if (nodePath === normalizedPath && nodeMethod === normalizedMethod) {
      return {
        entryNodeId: graph.entryNodeId ?? node.id,
        nodeId: node.id,
        webhookSecret: node.data?.webhookSecret?.trim() || undefined,
      }
    }
  }
  return null
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

/** 为图中 webhook-trigger 节点补齐 secret（发布时调用） */
export function ensureWebhookSecretsInGraph<T extends Record<string, unknown>>(graph: T): T {
  const cloned = structuredClone(graph)
  const nodes = cloned.nodes as WebhookGraphNode[] | undefined
  if (!Array.isArray(nodes)) return cloned

  for (const node of nodes) {
    if (node.type !== 'webhook-trigger') continue
    node.data = node.data ?? {}
    if (!node.data.webhookSecret?.trim()) {
      node.data.webhookSecret = generateWebhookSecret()
    }
  }
  return cloned
}

export function buildWebhookSignaturePayload(
  method: string,
  body: unknown,
  query: Record<string, unknown>,
): string {
  if (method.toUpperCase() === 'GET') {
    return JSON.stringify(query ?? {})
  }
  if (typeof body === 'string') return body
  return JSON.stringify(body ?? {})
}

export function verifyWebhookHmac(
  secret: string,
  signatureHeader: string | undefined,
  payload: string,
): boolean {
  if (!signatureHeader?.trim()) return false

  const expectedSig = createHmac('sha256', secret).update(payload).digest('hex')
  const providedSig = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader

  try {
    const sigBuffer = Buffer.from(providedSig, 'hex')
    const expectedBuffer = Buffer.from(expectedSig, 'hex')
    if (sigBuffer.length !== expectedBuffer.length) return false
    return timingSafeEqual(sigBuffer, expectedBuffer)
  } catch {
    return false
  }
}

export function shouldSkipWebhookHmac(): boolean {
  return process.env.NODE_ENV !== 'production'
    && process.env.AI_WEBHOOK_SKIP_HMAC === 'true'
}
