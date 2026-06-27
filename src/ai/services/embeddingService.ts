/**
 * Embedding Service — generates text embeddings via DeepSeek API.
 *
 * Uses the deepseek-embedding model (4096 dimensions).
 * Includes in-memory LRU cache to avoid redundant API calls.
 */

import OpenAI from 'openai'

const EMBEDDING_MODEL = 'deepseek-embedding'
const EMBEDDING_DIMENSIONS = 4096
const MAX_CACHE_SIZE = 500

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY environment variable is required.')
    }
    client = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey,
    })
  }
  return client
}

// ────────────────────────────────────────────
// LRU Cache
// ────────────────────────────────────────────

const cache = new Map<string, number[]>()

function cacheGet(key: string): number[] | undefined {
  const value = cache.get(key)
  if (value !== undefined) {
    // Move to end (most recently used)
    cache.delete(key)
    cache.set(key, value)
  }
  return value
}

function cacheSet(key: string, value: number[]): void {
  if (cache.has(key)) {
    cache.delete(key)
  } else if (cache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) {
      cache.delete(firstKey)
    }
  }
  cache.set(key, value)
}

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

export interface EmbeddingResult {
  vector: number[]
  dimensions: number
}

/**
 * Generate embedding for a single text string.
 *
 * Results are cached by text hash to avoid redundant API calls
 * for the same content.
 */
export async function embedText(text: string): Promise<EmbeddingResult> {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { vector: new Array(EMBEDDING_DIMENSIONS).fill(0), dimensions: EMBEDDING_DIMENSIONS }
  }

  const cached = cacheGet(trimmed)
  if (cached) {
    return { vector: cached, dimensions: cached.length }
  }

  const openai = getClient()
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: trimmed,
  })

  const vector = response.data[0].embedding
  cacheSet(trimmed, vector)

  return { vector, dimensions: vector.length }
}

/**
 * Generate embeddings for multiple texts in a single batch call.
 *
 * DeepSeek embedding API supports batch input (up to a reasonable limit).
 * Returns vectors in the same order as the input texts.
 */
export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return []

  // Check cache for all texts
  const results: (EmbeddingResult | null)[] = texts.map((t) => {
    const cached = cacheGet(t.trim())
    return cached ? { vector: cached, dimensions: cached.length } : null
  })

  // Find indices that need API calls
  const uncachedIndices: number[] = []
  const uncachedTexts: string[] = []
  for (let i = 0; i < results.length; i++) {
    if (results[i] === null && texts[i].trim().length > 0) {
      uncachedIndices.push(i)
      uncachedTexts.push(texts[i].trim())
    }
  }

  // Batch API call for uncached texts
  if (uncachedTexts.length > 0) {
    const openai = getClient()
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: uncachedTexts,
    })

    for (let i = 0; i < uncachedIndices.length; i++) {
      const vector = response.data[i].embedding
      cacheSet(uncachedTexts[i], vector)
      results[uncachedIndices[i]] = { vector, dimensions: vector.length }
    }
  }

  // Fill in zero vectors for empty strings
  return results.map((r, i) => {
    if (r) return r
    return { vector: new Array(EMBEDDING_DIMENSIONS).fill(0), dimensions: EMBEDDING_DIMENSIONS }
  })
}

export { EMBEDDING_DIMENSIONS }
