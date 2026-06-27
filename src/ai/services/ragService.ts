/**
 * RAG Service — indexes schemas and performs semantic vector search.
 *
 * Core capabilities:
 * 1. Index a schema: extract text features → generate embedding → store in MongoDB
 * 2. Semantic search: embed query → compute cosine similarity → return top-k
 * 3. Incremental updates: re-index only when schema content changes
 * 4. Bulk re-index: rebuild all embeddings (for initial setup or data migration)
 *
 * Uses DeepSeek embedding API (4096 dimensions) and stores vectors in
 * MongoDB with application-level cosine similarity computation.
 */

import { createHash } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { FormSchemaModel } from '../../models/FormSchema.js'
import { SchemaEmbeddingModel } from '../../models/SchemaEmbedding.js'
import { embedText, embedBatch } from './embeddingService.js'

// ────────────────────────────────────────────
// Content hash for change detection
// ────────────────────────────────────────────

/**
 * Compute a stable hash of schema content (name + json structure).
 * Used to detect whether a schema's embedding needs re-generation.
 */
export function computeContentHash(name: string, json: unknown): string {
  const text = extractTextForEmbedding(name, json)
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

// ────────────────────────────────────────────
// Text extraction from schema
// ────────────────────────────────────────────

interface ExtractedFeatures {
  text: string
  widgetTypes: string[]
  fieldNames: string[]
  labels: string[]
  description: string
}

/**
 * Extract human-readable text from a schema's JSON tree for embedding.
 *
 * Collects:
 * - Schema name
 * - Widget types (e.g., "input", "select", "table")
 * - Field names and labels
 * - Any description or placeholder text
 */
export function extractTextForEmbedding(name: string, json: unknown): string {
  const features = extractFeatures(name, json)
  return [
    name,
    features.description,
    features.labels.join(' '),
    features.fieldNames.join(' '),
    features.widgetTypes.join(' '),
  ].filter(Boolean).join(' ')
}

function extractFeatures(name: string, json: unknown): ExtractedFeatures {
  const widgetTypes: string[] = []
  const fieldNames: string[] = []
  const labels: string[] = []

  function walk(nodes: Record<string, unknown>[]): void {
    for (const node of nodes) {
      if (node.type) widgetTypes.push(String(node.type))
      if (node.field) fieldNames.push(String(node.field))
      if (node.label) labels.push(String(node.label))
      if (node.placeholder) labels.push(String(node.placeholder))
      if (node.title) labels.push(String(node.title))
      if (Array.isArray(node.children)) {
        walk(node.children as Record<string, unknown>[])
      }
      // Check props for nested config
      if (node.props && typeof node.props === 'object') {
        const props = node.props as Record<string, unknown>
        if (props.label) labels.push(String(props.label))
        if (props.placeholder) labels.push(String(props.placeholder))
        if (props.field) fieldNames.push(String(props.field))
      }
    }
  }

  if (Array.isArray(json)) {
    walk(json as Record<string, unknown>[])
  }

  // Deduplicate
  const uniqueWidgetTypes = [...new Set(widgetTypes)]
  const uniqueFieldNames = [...new Set(fieldNames)]
  const uniqueLabels = [...new Set(labels)]

  const description = uniqueLabels.length > 0
    ? `包含 ${uniqueWidgetTypes.length} 种组件类型，字段包括 ${uniqueLabels.slice(0, 10).join('、')}`
    : ''

  return {
    text: '',
    widgetTypes: uniqueWidgetTypes,
    fieldNames: uniqueFieldNames,
    labels: uniqueLabels,
    description,
  }
}

// ────────────────────────────────────────────
// Indexing
// ────────────────────────────────────────────

export interface IndexResult {
  schemaId: string
  action: 'created' | 'updated' | 'skipped'
}

/**
 * Index a single schema: generate embedding and store/update in MongoDB.
 *
 * Skips re-indexing if the content hash hasn't changed (schema unchanged).
 */
export async function indexSchema(schemaId: string): Promise<IndexResult> {
  const schema = await FormSchemaModel.findById(schemaId).lean() as Record<string, unknown> | null
  if (!schema) {
    throw new Error(`Schema ${schemaId} not found`)
  }

  const name = String(schema.name ?? '')
  const json = schema.json
  const type = String(schema.type ?? 'form') as 'form' | 'search_list'
  const editId = String(schema.editId ?? '')
  const contentHash = computeContentHash(name, json)

  // Check if embedding already exists and is current
  const existing = await SchemaEmbeddingModel.findOne({ editId }).lean() as Record<string, unknown> | null
  if (existing && existing.contentHash === contentHash) {
    return { schemaId, action: 'skipped' }
  }

  // Generate embedding
  const text = extractTextForEmbedding(name, json)
  const { vector } = await embedText(text)

  // Extract metadata
  const features = extractFeatures(name, json)

  if (existing) {
    // Update existing embedding
    await SchemaEmbeddingModel.updateOne(
      { editId },
      {
        schemaId,
        name,
        type,
        contentHash,
        embedding: vector,
        metadata: {
          widgetTypes: features.widgetTypes,
          fieldNames: features.fieldNames,
          labels: features.labels,
          description: features.description,
        },
      },
    )
    return { schemaId, action: 'updated' }
  }

  // Create new embedding
  await SchemaEmbeddingModel.create({
    _id: uuidv4(),
    schemaId,
    editId,
    name,
    type,
    contentHash,
    embedding: vector,
    metadata: {
      widgetTypes: features.widgetTypes,
      fieldNames: features.fieldNames,
      labels: features.labels,
      description: features.description,
    },
  })

  return { schemaId, action: 'created' }
}

/**
 * Bulk re-index all schemas.
 *
 * Useful for initial setup or after schema migration.
 * Returns counts of created, updated, skipped, and errored schemas.
 */
export async function reindexAll(): Promise<{
  total: number
  created: number
  updated: number
  skipped: number
  errors: number
}> {
  const schemas = await FormSchemaModel.find()
    .select('_id')
    .lean() as Array<Record<string, unknown>>

  const stats = { total: schemas.length, created: 0, updated: 0, skipped: 0, errors: 0 }

  for (const schema of schemas) {
    try {
      const result = await indexSchema(String(schema._id))
      stats[result.action]++
    } catch {
      stats.errors++
    }
  }

  return stats
}

// ────────────────────────────────────────────
// Semantic Search
// ────────────────────────────────────────────

export interface SearchResult {
  schemaId: string
  editId: string
  name: string
  type: string
  score: number
  metadata: {
    widgetTypes: string[]
    fieldNames: string[]
    labels: string[]
    description: string
  }
}

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

/**
 * Perform semantic search: embed the query, then find the most similar schemas.
 *
 * Returns top-k results sorted by similarity score (0-100).
 */
export async function semanticSearch(
  query: string,
  options: {
    limit?: number
    type?: 'form' | 'search_list'
    minScore?: number
  } = {},
): Promise<SearchResult[]> {
  const { limit = 5, type, minScore = 10 } = options

  // Embed the query
  const { vector: queryVector } = await embedText(query)

  // Fetch all embeddings (filtered by type if specified)
  const filter: Record<string, unknown> = {}
  if (type) {
    filter.type = type
  }

  const embeddings = await SchemaEmbeddingModel.find(filter)
    .select('schemaId editId name type embedding metadata')
    .lean() as Array<Record<string, unknown>>

  // Compute similarity scores
  const scored: SearchResult[] = []
  for (const doc of embeddings) {
    const embedding = doc.embedding as number[]
    const score = Math.round(cosineSimilarity(queryVector, embedding) * 100)

    if (score >= minScore) {
      scored.push({
        schemaId: String(doc.schemaId),
        editId: String(doc.editId),
        name: String(doc.name),
        type: String(doc.type),
        score,
        metadata: doc.metadata as SearchResult['metadata'],
      })
    }
  }

  // Sort by score descending, take top-k
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}
