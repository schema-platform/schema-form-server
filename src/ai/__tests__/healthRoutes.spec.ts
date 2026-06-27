/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock llmManager before importing the route
vi.mock('../services/llmManager.js', () => ({
  llmManager: {
    getProviderInfo: vi.fn().mockReturnValue([]),
    defaultProvider: 'deepseek',
  },
}))

import Koa from 'koa'
import http from 'node:http'
import healthRouter from '../healthRoutes.js'
import { llmManager } from '../services/llmManager.js'

let server: http.Server | null = null
let baseUrl = ''

async function request(method: string, path: string) {
  const url = `${baseUrl}${path}`
  const res = await fetch(url, { method })
  const body = await res.json()
  return { status: res.status, body }
}

beforeEach(async () => {
  vi.clearAllMocks()

  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  }

  const app = new Koa()
  app.use(healthRouter.routes())
  app.use(healthRouter.allowedMethods())

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server!.address() as { port: number }
      baseUrl = `http://localhost:${addr.port}`
      resolve()
    })
  })
})

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  }
})

describe('GET /api/ai/health', () => {
  it('returns ok status when providers are configured', async () => {
    vi.mocked(llmManager.getProviderInfo).mockReturnValue([
      {
        name: 'deepseek',
        models: ['deepseek-v4-pro'],
        defaultModel: 'deepseek-v4-pro',
        isDefault: true,
        qualityScore: 85,
        speedScore: 90,
        costPer1kPromptTokens: 0.0002,
        costPer1kCompletionTokens: 0.0008,
      },
    ])

    const res = await request('GET', '/api/ai/health')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('ok')
    expect(res.body.data.hasApiKey).toBe(true)
    expect(res.body.data.defaultProvider).toBe('deepseek')
    expect(res.body.data.providers).toHaveLength(1)
    expect(res.body.data.providers[0].name).toBe('deepseek')
    expect(res.body.data.providers[0].hasApiKey).toBe(true)
    expect(res.body.data.providers[0].model).toBe('deepseek-v4-pro')
    expect(res.body.data.providers[0].isDefault).toBe(true)
  })

  it('returns unconfigured status when no providers are registered', async () => {
    vi.mocked(llmManager.getProviderInfo).mockReturnValue([])

    const res = await request('GET', '/api/ai/health')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('unconfigured')
    expect(res.body.data.hasApiKey).toBe(false)
    expect(res.body.data.providers).toHaveLength(0)
  })

  it('returns multiple providers when several are configured', async () => {
    vi.mocked(llmManager.getProviderInfo).mockReturnValue([
      {
        name: 'deepseek',
        models: ['deepseek-v4-pro'],
        defaultModel: 'deepseek-v4-pro',
        isDefault: true,
        qualityScore: 85,
        speedScore: 90,
        costPer1kPromptTokens: 0.0002,
        costPer1kCompletionTokens: 0.0008,
      },
      {
        name: 'openai',
        models: ['gpt-4o'],
        defaultModel: 'gpt-4o',
        isDefault: false,
        qualityScore: 92,
        speedScore: 80,
        costPer1kPromptTokens: 0.005,
        costPer1kCompletionTokens: 0.015,
      },
    ])

    const res = await request('GET', '/api/ai/health')

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ok')
    expect(res.body.data.providers).toHaveLength(2)
    expect(res.body.data.providers[0].name).toBe('deepseek')
    expect(res.body.data.providers[0].isDefault).toBe(true)
    expect(res.body.data.providers[1].name).toBe('openai')
    expect(res.body.data.providers[1].isDefault).toBe(false)
  })

  it('never exposes actual API key values', async () => {
    vi.mocked(llmManager.getProviderInfo).mockReturnValue([
      {
        name: 'deepseek',
        models: ['deepseek-v4-pro'],
        defaultModel: 'deepseek-v4-pro',
        isDefault: true,
        qualityScore: 85,
        speedScore: 90,
        costPer1kPromptTokens: 0.0002,
        costPer1kCompletionTokens: 0.0008,
      },
    ])

    const res = await request('GET', '/api/ai/health')
    const json = JSON.stringify(res.body)

    // Should not contain any API key patterns
    expect(json).not.toContain('sk-')
    expect(json).not.toContain('apiKey')
    expect(json).not.toContain('api_key')
  })
})
