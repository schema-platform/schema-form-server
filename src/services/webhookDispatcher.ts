import crypto from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { eventBus } from './eventBus.js'
import { WebhookModel, type IWebhook } from '../models/Webhook.js'
import { WebhookLogModel } from '../models/WebhookLog.js'

// ── Types ────────────────────────────────────────────────────────────────────

interface WebhookPayload {
  event: string
  data: unknown
  timestamp: string
  signature: string
}

interface DeliveryResult {
  success: boolean
  statusCode: number
  responseBody: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 5
const INITIAL_BACKOFF_MS = 1000
const REQUEST_TIMEOUT_MS = 10000

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate HMAC-SHA256 signature for payload verification.
 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calculate exponential backoff delay with jitter.
 */
function getBackoffDelay(attempt: number): number {
  const base = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
  const jitter = Math.random() * 1000
  return base + jitter
}

// ── Delivery ─────────────────────────────────────────────────────────────────

/**
 * Deliver a webhook payload to a single URL.
 * Uses native fetch with timeout.
 */
async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
): Promise<DeliveryResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': payload.event,
        'X-Webhook-Signature': payload.signature,
        'X-Webhook-Timestamp': payload.timestamp,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const responseBody = await response.text().catch(() => '')

    return {
      success: response.ok,
      statusCode: response.status,
      responseBody,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      statusCode: 0,
      responseBody: `Network error: ${message}`,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Deliver webhook with retry logic (exponential backoff).
 * Logs each attempt to WebhookLog.
 */
async function deliverWithRetry(
  webhook: IWebhook,
  event: string,
  data: unknown,
): Promise<void> {
  const maxRetries = webhook.retryPolicy?.maxRetries ?? MAX_RETRIES
  let lastResult: DeliveryResult | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Build payload
    const timestamp = new Date().toISOString()
    const payloadData = { event, data, timestamp }
    const payloadString = JSON.stringify(payloadData)
    const signature = signPayload(payloadString, webhook.secret)

    const payload: WebhookPayload = {
      event,
      data,
      timestamp,
      signature,
    }

    // Deliver
    lastResult = await deliverWebhook(webhook.url, payload)

    // Log attempt
    await WebhookLogModel.create({
      _id: uuidv4(),
      webhookId: webhook._id,
      event,
      status: lastResult.success ? 'success' : 'failed',
      statusCode: lastResult.statusCode,
      requestBody: payloadData,
      responseBody: lastResult.responseBody,
      retryCount: attempt,
      tenantId: webhook.tenantId,
    })

    // Exit on success
    if (lastResult.success) {
      console.log(
        `[webhook] Delivered "${event}" to ${webhook.url} (attempt ${attempt + 1})`,
      )
      return
    }

    // Log failure and retry if attempts remain
    console.warn(
      `[webhook] Failed to deliver "${event}" to ${webhook.url} ` +
        `(attempt ${attempt + 1}/${maxRetries + 1}, status=${lastResult.statusCode})`,
    )

    if (attempt < maxRetries) {
      const delay = getBackoffDelay(attempt)
      console.log(`[webhook] Retrying in ${Math.round(delay)}ms...`)
      await sleep(delay)
    }
  }

  // All retries exhausted
  console.error(
    `[webhook] Exhausted all ${maxRetries + 1} attempts for "${event}" → ${webhook.url}`,
  )
}

// ── Event Handler ────────────────────────────────────────────────────────────

/**
 * Handle an event from eventBus:
 * 1. Find all active webhooks subscribed to this event
 * 2. Deliver payload to each webhook concurrently
 */
async function handleEvent(event: string, data: unknown): Promise<void> {
  // Query active webhooks that subscribe to this event
  // Use lean() for performance — we don't need Mongoose documents
  const webhooks = await WebhookModel.find({
    status: 'active',
    events: event,
  }).lean<IWebhook[]>()

  if (webhooks.length === 0) {
    return
  }

  console.log(
    `[webhook] Dispatching "${event}" to ${webhooks.length} webhook(s)`,
  )

  // Deliver to all webhooks concurrently
  // Each webhook handles its own retries independently
  await Promise.allSettled(
    webhooks.map((webhook) => deliverWithRetry(webhook, event, data)),
  )
}

// ── Dispatcher Lifecycle ─────────────────────────────────────────────────────

let initialized = false

/**
 * Initialize the webhook dispatcher.
 * Subscribes to all supported events on the eventBus.
 *
 * Safe to call multiple times — idempotent.
 */
export function initWebhookDispatcher(): void {
  if (initialized) {
    console.warn('[webhook] Dispatcher already initialized')
    return
  }

  const events = ['schema.published', 'submission.created', 'flow.completed', 'flow.rejected']

  for (const event of events) {
    eventBus.on(event, (data: unknown) => {
      handleEvent(event, data).catch((err: unknown) => {
        console.error(
          `[webhook] Unhandled error in dispatcher for "${event}":`,
          err instanceof Error ? err.message : String(err),
        )
      })
    })
  }

  initialized = true
  console.log('[webhook] Dispatcher initialized, listening for events:', events.join(', '))
}
