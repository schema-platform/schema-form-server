/**
 * RAG Management Routes.
 *
 * Provides administrative endpoints for the RAG knowledge base:
 * - POST   /api/ai/rag/reindex       — Batch rebuild all schema embeddings
 * - GET    /api/ai/rag/status         — Index status and statistics
 * - DELETE /api/ai/rag/:schemaId      — Delete a single schema's embedding
 * - POST   /api/ai/rag/reindex/:schemaId — Re-index a single schema
 */

import Router from '@koa/router'
import { reindexAll, indexSchema } from './services/ragService.js'
import { FormSchemaModel } from '../models/FormSchema.js'
import { SchemaEmbeddingModel } from '../models/SchemaEmbedding.js'
import { authMiddleware } from '../middleware/auth.js'
import { logger } from '../utils/logger.js'

const router = new Router({ prefix: '/api/ai/rag' })

// All RAG routes require authentication
router.use(authMiddleware())

// ────────────────────────────────────────────
// POST /api/ai/rag/reindex — Batch rebuild all embeddings
// ────────────────────────────────────────────

router.post('/reindex', async (ctx) => {
  logger.info({ msg: 'rag:reindex:start' })

  const stats = await reindexAll()

  logger.info({
    msg: 'rag:reindex:complete',
    total: stats.total,
    created: stats.created,
    updated: stats.updated,
    skipped: stats.skipped,
    errors: stats.errors,
  })

  ctx.body = {
    success: true,
    data: {
      total: stats.total,
      created: stats.created,
      updated: stats.updated,
      skipped: stats.skipped,
      errors: stats.errors,
    },
  }
})

// ────────────────────────────────────────────
// GET /api/ai/rag/status — Index statistics
// ────────────────────────────────────────────

router.get('/status', async (ctx) => {
  const [totalSchemas, totalEmbeddings] = await Promise.all([
    FormSchemaModel.countDocuments(),
    SchemaEmbeddingModel.countDocuments(),
  ])

  // Find schemas that have no embedding (need indexing)
  const embeddedSchemaIds = await SchemaEmbeddingModel.find()
    .select('schemaId')
    .lean() as unknown as Array<{ schemaId: string }>
  const embeddedIdSet = new Set(embeddedSchemaIds.map((e) => e.schemaId))

  const allSchemas = await FormSchemaModel.find()
    .select('_id name type updatedAt')
    .lean() as unknown as Array<{ _id: string; name: string; type: string; updatedAt: Date }>

  const indexed = allSchemas.filter((s) => embeddedIdSet.has(s._id))
  const unindexed = allSchemas.filter((s) => !embeddedIdSet.has(s._id))

  // Stale embeddings: embedding exists but schema was updated after embedding
  const staleEmbeddings = await SchemaEmbeddingModel.find()
    .select('schemaId updatedAt')
    .lean() as unknown as Array<{ schemaId: string; updatedAt: Date }>

  const staleSet = new Set<string>()
  const schemaUpdateMap = new Map(allSchemas.map((s) => [s._id, s.updatedAt]))

  for (const emb of staleEmbeddings) {
    const schemaUpdated = schemaUpdateMap.get(emb.schemaId)
    if (schemaUpdated && schemaUpdated > emb.updatedAt) {
      staleSet.add(emb.schemaId)
    }
  }

  ctx.body = {
    success: true,
    data: {
      totalSchemas,
      totalEmbeddings,
      indexed: indexed.length,
      unindexed: unindexed.length,
      stale: staleSet.size,
      unindexedSchemas: unindexed.map((s) => ({
        id: s._id,
        name: s.name,
        type: s.type,
      })),
    },
  }
})

// ────────────────────────────────────────────
// DELETE /api/ai/rag/:schemaId — Delete embedding for a schema
// ────────────────────────────────────────────

router.delete('/:schemaId', async (ctx) => {
  const { schemaId } = ctx.params

  const schema = await FormSchemaModel.findById(schemaId)
    .select('_id name')
    .lean() as { _id: string; name: string } | null

  if (!schema) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Schema not found' } }
    return
  }

  const result = await SchemaEmbeddingModel.deleteOne({ schemaId })

  if (result.deletedCount === 0) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'No embedding found for this schema' } }
    return
  }

  logger.info({ msg: 'rag:delete', schemaId, name: schema.name })

  ctx.body = {
    success: true,
    data: { schemaId, deleted: true },
  }
})

// ────────────────────────────────────────────
// POST /api/ai/rag/reindex/:schemaId — Re-index a single schema
// ────────────────────────────────────────────

router.post('/reindex/:schemaId', async (ctx) => {
  const { schemaId } = ctx.params

  const schema = await FormSchemaModel.findById(schemaId)
    .select('_id name')
    .lean() as { _id: string; name: string } | null

  if (!schema) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Schema not found' } }
    return
  }

  const result = await indexSchema(schemaId)

  logger.info({ msg: 'rag:reindex:single', schemaId, action: result.action })

  ctx.body = {
    success: true,
    data: {
      schemaId: result.schemaId,
      action: result.action,
    },
  }
})

export default router
