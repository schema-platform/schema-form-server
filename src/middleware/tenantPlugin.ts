/**
 * Mongoose Tenant Plugin
 *
 * Automatically injects tenantId filtering into all queries and
 * sets tenantId on save to enforce multi-tenant data isolation.
 *
 * Usage:
 *   schema.plugin(tenantPlugin)
 *
 * The plugin reads tenantId from AsyncLocalStorage (set by tenantContextMiddleware).
 * If no tenantId is in context, the operation is allowed to proceed without
 * filtering — this handles bootstrapping, migrations, and system-level operations.
 *
 * Models that should NOT be tenant-scoped (User, Tenant) are excluded by not
 * applying this plugin to their schemas.
 */

import type { Schema, Query, Aggregate } from 'mongoose'
import { tenantStorage } from './tenantContext.js'

function getCurrentTenantId(): string | undefined {
  return tenantStorage.getStore()?.tenantId
}

/**
 * Determines if a Mongoose operation should skip tenant filtering.
 * Certain query helpers (count, distinct) are safe to add tenantId to;
 * others like $expr with pipeline semantics are handled in aggregate.
 */
function shouldSkipTenantFilter(query: Query<unknown, unknown>): boolean {
  // If the query already has an explicit tenantId, don't double-filter
  const cond = query.getFilter()
  if (cond.tenantId !== undefined) return true
  return false
}

/**
 * Apply tenant filtering to a populate path.
 *
 * When a query uses .populate(), each populated path's match condition
 * needs tenantId injected. Mongoose exposes populate options via
 * `query.getOptions().populate`. We iterate each path and add tenantId
 * to its `match` if it doesn't already have one.
 */
function applyPopulateTenantFilter(query: Query<unknown, unknown>, tenantId: string): void {
  const options = query.getOptions()
  if (!options.populate) return

  // populate can be a string, object, or array of objects
  const populates = Array.isArray(options.populate)
    ? options.populate
    : [options.populate]

  for (const pop of populates) {
    if (typeof pop === 'string') {
      // string path — convert to object form with match
      // We need to modify the options in place
      const idx = Array.isArray(options.populate)
        ? (options.populate as unknown[]).indexOf(pop)
        : -1
      const entry = { path: pop, match: { tenantId } }
      if (idx >= 0) {
        ;(options.populate as unknown[])[idx] = entry
      } else {
        options.populate = entry as any
      }
    } else if (pop && typeof pop === 'object') {
      // object form — inject tenantId into match
      const popObj = pop as unknown as Record<string, unknown>
      if (!popObj.match) {
        popObj.match = { tenantId }
      } else if (typeof popObj.match === 'object' && (popObj.match as Record<string, unknown>).tenantId === undefined) {
        ;(popObj.match as Record<string, unknown>).tenantId = tenantId
      }
    }
  }
}

/**
 * The tenant plugin. Apply to any schema that needs tenant isolation:
 *
 *   const formSchemaDef = new mongoose.Schema(...)
 *   formSchemaDef.plugin(tenantPlugin)
 */
export function tenantPlugin(schema: Schema): void {
  // ── pre('find') ──
  schema.pre('find', function (this: Query<unknown, unknown>) {
    const tenantId = getCurrentTenantId()
    if (!tenantId) return
    if (shouldSkipTenantFilter(this)) return

    this.where({ tenantId })
    applyPopulateTenantFilter(this, tenantId)
  })

  // ── pre('findOne') ──
  schema.pre('findOne', function (this: Query<unknown, unknown>) {
    const tenantId = getCurrentTenantId()
    if (!tenantId) return
    if (shouldSkipTenantFilter(this)) return

    this.where({ tenantId })
    applyPopulateTenantFilter(this, tenantId)
  })

  // ── pre('findOneAndUpdate') ──
  schema.pre('findOneAndUpdate', function (this: Query<unknown, unknown>) {
    const tenantId = getCurrentTenantId()
    if (!tenantId) return
    if (shouldSkipTenantFilter(this)) return

    this.where({ tenantId })
  })

  // ── pre('findOneAndDelete') ──
  schema.pre('findOneAndDelete', function (this: Query<unknown, unknown>) {
    const tenantId = getCurrentTenantId()
    if (!tenantId) return
    if (shouldSkipTenantFilter(this)) return

    this.where({ tenantId })
  })

  // ── pre('findOneAndReplace') ──
  schema.pre('findOneAndReplace', function (this: Query<unknown, unknown>) {
    const tenantId = getCurrentTenantId()
    if (!tenantId) return
    if (shouldSkipTenantFilter(this)) return

    this.where({ tenantId })
  })

  // ── pre('countDocuments') ──
  schema.pre('countDocuments', function (this: Query<unknown, unknown>) {
    const tenantId = getCurrentTenantId()
    if (!tenantId) return
    if (shouldSkipTenantFilter(this)) return

    this.where({ tenantId })
  })

  // ── pre('save') — inject tenantId on new documents ──
  schema.pre('save', function (this: { tenantId?: string; isNew?: boolean }) {
    const tenantId = getCurrentTenantId()
    if (!tenantId) return

    // Only set on new documents that have the default tenantId
    // If the document was explicitly given a tenantId, respect it
    if (this.isNew && this.tenantId === '000000') {
      this.tenantId = tenantId
    }
  })

  // ── pre('aggregate') ──
  schema.pre('aggregate', function (this: Aggregate<unknown[]>) {
    const tenantId = getCurrentTenantId()
    if (!tenantId) return

    const pipeline = this.pipeline()

    // Don't double-inject if $match with tenantId already exists
    const hasTenantMatch = pipeline.some(
      (stage) => '$match' in stage && (stage.$match as Record<string, unknown>).tenantId !== undefined,
    )
    if (hasTenantMatch) return

    // Insert $match at the beginning of the pipeline
    pipeline.unshift({ $match: { tenantId } })
  })
}
