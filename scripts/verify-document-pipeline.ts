#!/usr/bin/env tsx
/**
 * 两条文档线现场验证脚本（需 MongoDB + 已 seed admin）
 *
 * 用法：
 *   cd schema-form-server
 *   AI_WEBHOOK_SKIP_HMAC=true pnpm exec tsx scripts/verify-document-pipeline.ts
 *
 * 环境变量：
 *   API_BASE          默认 http://localhost:3001
 *   AI_WEBHOOK_SKIP_HMAC  本地可 true
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import mongoose from 'mongoose'

const API_BASE = process.env.API_BASE ?? 'http://localhost:3001'

interface StepResult {
  name: string
  ok: boolean
  detail?: string
}

const results: StepResult[] = []

function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail })
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail })
  console.error(`✗ ${name} — ${detail}`)
}

async function api(
  method: string,
  urlPath: string,
  opts: { body?: unknown; headers?: Record<string, string>; form?: FormData } = {},
) {
  const headers: Record<string, string> = { ...opts.headers }
  let body: BodyInit | undefined
  if (opts.form) {
    body = opts.form
  } else if (opts.body != null) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  const res = await fetch(`${API_BASE}${urlPath}`, { method, headers, body })
  const text = await res.text()
  let json: unknown = text
  try {
    json = JSON.parse(text)
  } catch {
    // keep text
  }
  return { status: res.status, body: json, text }
}

async function main() {
  console.log(`\n=== Document Pipeline Live Verification ===`)
  console.log(`API: ${API_BASE}\n`)

  // Health
  try {
    const health = await api('GET', '/api/health')
    if (health.status === 200) pass('Server health')
    else fail('Server health', `status ${health.status}`)
  } catch (err) {
    fail('Server health', err instanceof Error ? err.message : String(err))
    printSummary()
    process.exit(1)
  }

  // ── Line A: Chat document upload ──
  const tmpFile = path.join(os.tmpdir(), `verify-chat-${Date.now()}.txt`)
  await fs.writeFile(tmpFile, 'Live verification chat document line.', 'utf-8')

  const form = new FormData()
  const blob = new Blob([await fs.readFile(tmpFile)], { type: 'text/plain' })
  form.append('file', blob, 'verify-chat.txt')

  const upload = await api('POST', '/api/ai/documents/upload', { form })
  const uploadData = (upload.body as { success?: boolean; data?: { id: string; text: string; hasOriginalFile?: boolean } })

  if (upload.status === 200 && uploadData.success && uploadData.data?.id) {
    pass('Chat line: upload', `documentId=${uploadData.data.id}`)
    const docId = uploadData.data.id

    const preview = await api('GET', `/api/ai/documents/${docId}/preview`)
    const previewData = (preview.body as { data?: { text: string } })
    if (preview.status === 200 && previewData.data?.text?.includes('Live verification')) {
      pass('Chat line: preview')
    } else {
      fail('Chat line: preview', `status ${preview.status}`)
    }

    const storageRoot = process.env.AI_DOCUMENT_STORAGE_ROOT
      || path.join(os.homedir(), 'payflow', 'schema-flow')
    const storageDir = path.join(storageRoot, 'ai-documents')
    try {
      const entries = await fs.readdir(storageDir, { recursive: true })
      if (entries.length > 0) pass('Chat line: disk storage', storageDir)
      else fail('Chat line: disk storage', 'no files under ai-documents')
    } catch {
      fail('Chat line: disk storage', `cannot read ${storageDir}`)
    }
  } else {
    fail('Chat line: upload', `status ${upload.status} ${JSON.stringify(upload.body)}`)
  }

  // ── Line B: Workflow webhook (optional, needs published workflow) ──
  const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/schema-form'
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 })
    const { AgentWorkflowModel } = await import('../src/ai/models/agentWorkflow.js')
    const published = await AgentWorkflowModel.findOne({ status: 'published' }).lean() as {
      publishedGraph?: { nodes?: Array<{ type: string; data?: { webhookPath?: string; webhookMethod?: string; webhookSecret?: string } }> }
    } | null

    if (published?.publishedGraph?.nodes) {
      const wh = published.publishedGraph.nodes.find((n) => n.type === 'webhook-trigger')
      if (wh?.data?.webhookPath) {
        const hookPath = wh.data.webhookPath.replace(/^\//, '')
        const secret = wh.data.webhookSecret
        const body = { documentId: uploadData.data?.id ?? 'test', ping: true }
        const payload = JSON.stringify(body)
        const headers: Record<string, string> = {}
        if (secret && process.env.AI_WEBHOOK_SKIP_HMAC !== 'true') {
          const sig = createHmac('sha256', secret).update(payload).digest('hex')
          headers['X-Webhook-Signature'] = `sha256=${sig}`
        }
        const hook = await api('POST', `/api/ai/webhooks/${hookPath}`, { body, headers })
        if (hook.status === 202) pass('Workflow line: webhook trigger', hookPath)
        else fail('Workflow line: webhook trigger', `status ${hook.status} ${JSON.stringify(hook.body)}`)
      } else {
        pass('Workflow line: webhook trigger', 'skipped — no published webhook-trigger workflow')
      }
    } else {
      pass('Workflow line: webhook trigger', 'skipped — no published workflow in DB')
    }
    await mongoose.disconnect()
  } catch (err) {
    fail('Workflow line: mongo/webhook', err instanceof Error ? err.message : String(err))
  }

  await fs.unlink(tmpFile).catch(() => {})
  printSummary()
  process.exit(results.some((r) => !r.ok) ? 1 : 0)
}

function printSummary() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`)
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL: ${f.name} — ${f.detail}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
