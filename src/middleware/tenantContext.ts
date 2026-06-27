/**
 * Tenant Context — AsyncLocalStorage-based tenantId propagation.
 *
 * Two-phase design:
 * 1. Global middleware (runs before auth): sets default tenantId from header or fallback
 * 2. Per-route middleware (runs after auth): updates tenantId from JWT payload
 *
 * The Mongoose tenantPlugin reads tenantId from AsyncLocalStorage in pre-hooks
 * to enforce data isolation across all tenant-scoped collections.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Middleware } from 'koa'

// ── AsyncLocalStorage for tenant context ──

interface TenantContext {
  tenantId: string
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>()

/** Get the current tenantId from async context. Returns undefined if not set. */
export function getCurrentTenantId(): string | undefined {
  return tenantStorage.getStore()?.tenantId
}

// ── Koa middleware ──

const DEFAULT_TENANT_ID = '000000'

/**
 * Global middleware: initializes tenant context with default/header value.
 * Runs BEFORE auth middleware, so ctx.state.user is not yet available.
 *
 * For unauthenticated requests, this is the final tenantId.
 * For authenticated requests, authMiddleware() overrides it via syncTenantFromUser().
 */
export function tenantContextMiddleware(): Middleware {
  return async (ctx, next) => {
    const headerTenantId = ctx.get('X-Tenant-Id')
    const tenantId = headerTenantId || DEFAULT_TENANT_ID

    ctx.state.tenantId = tenantId

    await tenantStorage.run({ tenantId }, async () => {
      await next()
    })
  }
}

