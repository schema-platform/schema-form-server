type EventHandler = (...args: unknown[]) => void | Promise<void>

/**
 * Simple in-process publish/subscribe event bus.
 *
 * Supported events:
 *  - schema.published
 *  - submission.created
 *  - flow.completed
 *  - flow.rejected
 *
 * This is intentionally minimal — no persistence, no replay.
 * Webhook delivery is handled separately by the webhook dispatcher
 * which subscribes to these events.
 */

const SUPPORTED_EVENTS = new Set([
  'schema.published',
  'submission.created',
  'flow.completed',
  'flow.rejected',
  'webhook.triggered',
])

class EventBus {
  private listeners = new Map<string, Set<EventHandler>>()

  /**
   * Subscribe to an event.
   * @returns unsubscribe function
   */
  on(event: string, handler: EventHandler): () => void {
    if (!SUPPORTED_EVENTS.has(event)) {
      throw new Error(`Unsupported event: "${event}". Supported: ${[...SUPPORTED_EVENTS].join(', ')}`)
    }
    let handlers = this.listeners.get(event)
    if (!handlers) {
      handlers = new Set()
      this.listeners.set(event, handlers)
    }
    handlers.add(handler)
    return () => handlers!.delete(handler)
  }

  /**
   * Emit an event to all registered handlers.
   * Handlers are invoked concurrently; errors are collected and logged
   * but do not prevent other handlers from running.
   */
  async emit(event: string, data: unknown): Promise<void> {
    if (!SUPPORTED_EVENTS.has(event)) {
      console.warn(`[eventBus] Emit skipped — unknown event: "${event}"`)
      return
    }
    const handlers = this.listeners.get(event)
    if (!handlers || handlers.size === 0) return

    const results = await Promise.allSettled(
      [...handlers].map((handler) => handler(data)),
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`[eventBus] Handler for "${event}" failed:`, result.reason)
      }
    }
  }

  /** Remove all listeners (useful in tests). */
  clear(): void {
    this.listeners.clear()
  }
}

export const eventBus = new EventBus()
