import { createHmac, timingSafeEqual } from 'node:crypto'
import Router from '@koa/router'
import { validate as uuidValidate } from 'uuid'
import { WebhookModel } from '../models/Webhook.js'
import { flowEngine } from '../flow-services/FlowEngine.js'
import { eventBus } from '../services/eventBus.js'

const router = new Router({ prefix: '/api/webhooks' })

/**
 * POST /api/webhooks/:webhookId/trigger
 *
 * External entry point: receives an HTTP request and starts a flow instance.
 *
 * Flow:
 *  1. Look up webhook, validate status
 *  2. Verify HMAC signature (X-Webhook-Signature) if webhook has a secret
 *  3. Extract and map request data to flow variables via bodyMapping
 *  4. Start a FlowInstance via FlowEngine.startFlow
 *  5. Emit 'webhook.triggered' event on success
 *
 * Authentication: HMAC only (no JWT). This endpoint is called by external systems.
 */
router.post('/:webhookId/trigger', async (ctx) => {
  const { webhookId } = ctx.params

  if (!uuidValidate(webhookId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid webhook ID format.' } }
    return
  }

  // ── 1. Look up webhook ──
  const webhook = await WebhookModel.findById(webhookId)
  if (!webhook) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Webhook not found.' } }
    return
  }

  if (webhook.status !== 'active') {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'Webhook is inactive.' } }
    return
  }

  if (!webhook.flowDefinitionId) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Webhook is not linked to a flow definition.' } }
    return
  }

  // ── 2. Verify HMAC signature ──
  const signatureHeader = ctx.get('X-Webhook-Signature')
  if (!signatureHeader) {
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'Missing X-Webhook-Signature header.' } }
    return
  }

  const rawBody = typeof ctx.request.body === 'string'
    ? ctx.request.body
    : JSON.stringify(ctx.request.body ?? {})

  const expectedSig = createHmac('sha256', webhook.secret)
    .update(rawBody)
    .digest('hex')

  // Accept "sha256=<hex>" or bare "<hex>" formats
  const providedSig = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader

  // Use timing-safe comparison
  const sigBuffer = Buffer.from(providedSig, 'hex')
  const expectedBuffer = Buffer.from(expectedSig, 'hex')

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'Invalid webhook signature.' } }
    return
  }

  // ── 3. Extract and map request data to flow variables ──
  const requestBody = (typeof ctx.request.body === 'object' && ctx.request.body !== null)
    ? ctx.request.body as Record<string, unknown>
    : {}

  const variables: Record<string, unknown> = {}
  const bodyMapping: Record<string, string> = webhook.bodyMapping ?? {}

  if (Object.keys(bodyMapping).length > 0) {
    // Apply explicit mapping: { "requestField": "flowVarName" }
    for (const [requestField, flowVarName] of Object.entries(bodyMapping)) {
      if (requestField in requestBody) {
        variables[flowVarName] = (requestBody as Record<string, unknown>)[requestField]
      }
    }
  } else {
    // No mapping defined — pass entire body as payload
    Object.assign(variables, requestBody)
  }

  // Always include trigger metadata
  variables._triggerSource = 'webhook'
  variables._webhookId = webhookId

  // ── 4. Start flow instance ──
  const instance = await flowEngine.startFlow(
    webhook.flowDefinitionId!,
    variables,
    `webhook:${webhookId}`,
  )

  // ── 5. Emit webhook.triggered event ──
  eventBus.emit('webhook.triggered', {
    webhookId,
    instanceId: (instance as unknown as { _id: string })?._id,
  }).catch((err) => console.error('[webhook.triggered] emit failed:', err))

  ctx.status = 201
  ctx.body = {
    success: true,
    data: {
      instanceId: instance?._id,
      status: 'running',
    },
  }
})

/**
 * GET /api/webhooks/:webhookId/trigger
 *
 * Simple GET trigger — for webhooks that only need query parameters.
 * Same HMAC verification using the query string as the signed payload.
 */
router.get('/:webhookId/trigger', async (ctx) => {
  const { webhookId } = ctx.params

  if (!uuidValidate(webhookId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid webhook ID format.' } }
    return
  }

  const webhook = await WebhookModel.findById(webhookId)
  if (!webhook) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Webhook not found.' } }
    return
  }

  if (webhook.status !== 'active') {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'Webhook is inactive.' } }
    return
  }

  if (!webhook.flowDefinitionId) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Webhook is not linked to a flow definition.' } }
    return
  }

  // Verify HMAC on the query string
  const signatureHeader = ctx.get('X-Webhook-Signature')
  if (!signatureHeader) {
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'Missing X-Webhook-Signature header.' } }
    return
  }

  const payload = ctx.querystring || ''
  const expectedSig = createHmac('sha256', webhook.secret)
    .update(payload)
    .digest('hex')

  const providedSig = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader

  const sigBuffer = Buffer.from(providedSig, 'hex')
  const expectedBuffer = Buffer.from(expectedSig, 'hex')

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    ctx.status = 401
    ctx.body = { success: false, error: { message: 'Invalid webhook signature.' } }
    return
  }

  // Map query params to flow variables
  const variables: Record<string, unknown> = {}
  const bodyMapping: Record<string, string> = webhook.bodyMapping ?? {}
  const queryObj = ctx.query as Record<string, string>

  if (Object.keys(bodyMapping).length > 0) {
    for (const [requestField, flowVarName] of Object.entries(bodyMapping)) {
      if (requestField in queryObj) {
        variables[flowVarName] = (queryObj as Record<string, unknown>)[requestField]
      }
    }
  } else {
    Object.assign(variables, queryObj)
  }

  variables._triggerSource = 'webhook'
  variables._webhookId = webhookId

  const instance = await flowEngine.startFlow(
    webhook.flowDefinitionId,
    variables,
    `webhook:${webhookId}`,
  )

  eventBus.emit('webhook.triggered', {
    webhookId,
    instanceId: instance?._id,
  }).catch((err) => console.error('[webhook.triggered] emit failed:', err))

  ctx.status = 201
  ctx.body = {
    success: true,
    data: {
      instanceId: instance?._id,
      status: 'running',
    },
  }
})

export default router
