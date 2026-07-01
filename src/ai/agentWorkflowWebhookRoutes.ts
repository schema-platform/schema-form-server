/**
 * Agent 工作流 Webhook 触发入口
 *
 * POST/GET /api/ai/webhooks/*path
 *
 * 鉴权：HMAC-SHA256（与 BPMN Webhook 一致），请求头 X-Webhook-Signature: sha256=<hex>
 * 开发环境可设 AI_WEBHOOK_SKIP_HMAC=true 跳过验签。
 */

import Router from '@koa/router'
import {
  findPublishedWorkflowByWebhook,
  startAgentWorkflowExecution,
} from './services/agentWorkflowService.js'
import {
  normalizeWebhookPath,
  buildWebhookSignaturePayload,
  verifyWebhookHmac,
  shouldSkipWebhookHmac,
} from './services/agentWorkflowWebhookUtils.js'
import { logger } from '../utils/logger.js'

const router = new Router({ prefix: '/api/ai/webhooks' })

async function handleWebhook(ctx: {
  method: string
  params: { path?: string }
  get: (name: string) => string
  request: { body?: unknown; query?: Record<string, unknown> }
  status: number
  body: unknown
}) {
  const rawPath = ctx.params.path ?? ''
  const webhookPath = normalizeWebhookPath(`/${rawPath}`)
  const httpMethod = ctx.method.toUpperCase()

  const match = await findPublishedWorkflowByWebhook(webhookPath, httpMethod)
  if (!match) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Webhook not found' } }
    return
  }

  const secret = match.webhookSecret
  if (secret && !shouldSkipWebhookHmac()) {
    const payload = buildWebhookSignaturePayload(
      httpMethod,
      ctx.request.body,
      ctx.request.query ?? {},
    )
    const signatureHeader = ctx.get('X-Webhook-Signature')
    if (!verifyWebhookHmac(secret, signatureHeader, payload)) {
      ctx.status = 401
      ctx.body = { success: false, error: { message: 'Invalid or missing X-Webhook-Signature' } }
      return
    }
  }

  const input: Record<string, unknown> = {
    method: ctx.method,
    path: webhookPath,
    query: ctx.request.query ?? {},
    body: ctx.request.body ?? {},
    headers: {},
  }

  if (httpMethod === 'GET') {
    input.message = JSON.stringify(ctx.request.query ?? {})
  } else {
    input.message = typeof ctx.request.body === 'string'
      ? ctx.request.body
      : JSON.stringify(ctx.request.body ?? {})
  }

  try {
    const execution = await startAgentWorkflowExecution(
      match.workflowId,
      match.createdBy,
      input,
      { trigger: 'webhook' },
    )

    if (!execution) {
      ctx.status = 500
      ctx.body = { success: false, error: { message: 'Failed to start workflow' } }
      return
    }

    ctx.status = 202
    ctx.body = {
      success: true,
      data: {
        executionId: execution.id,
        workflowId: match.workflowId,
        workflowName: match.workflowName,
        status: execution.status,
      },
    }
  } catch (err) {
    logger.error({ msg: '[webhook] execution start failed', err, webhookPath })
    ctx.status = 500
    ctx.body = { success: false, error: { message: 'Webhook execution failed' } }
  }
}

router.get('/:path(.*)', handleWebhook)
router.post('/:path(.*)', handleWebhook)
router.put('/:path(.*)', handleWebhook)
router.patch('/:path(.*)', handleWebhook)
router.delete('/:path(.*)', handleWebhook)

export default router
