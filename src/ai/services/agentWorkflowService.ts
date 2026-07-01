/**
 * Agent 工作流 CRUD 与执行调度
 *
 * 发布与版本规则对齐可视化编辑器：
 * - 版本号：yyyymmddhhmmss 时间戳字符串
 * - 版本快照：嵌入在 workflow 文档的 versions 数组中（最多 MAX_VERSIONS 个）
 * - 发布：使用稳定 publishId (UUID)，首次发布生成，后续复用；发布快照存入 publishedGraph
 */

import mongoose from 'mongoose'
import { v4 as uuidv4 } from 'uuid'
import {
  AgentWorkflowModel,
  AgentWorkflowExecutionModel,
} from '../models/agentWorkflow.js'
import { executeAgentWorkflow } from './agentWorkflowExecutor.js'
import { ensureWebhookSecretsInGraph } from './agentWorkflowWebhookUtils.js'
import { logger } from '../../utils/logger.js'
import { docId, refId, toObjectId } from '../../utils/objectId.js'

const MAX_VERSIONS = 20

function generateVersion(): string {
  const now = new Date()
  const pad = (n: number, len: number) => String(n).padStart(len, '0')
  return (
    pad(now.getFullYear(), 4) +
    pad(now.getMonth() + 1, 2) +
    pad(now.getDate(), 2) +
    pad(now.getHours(), 2) +
    pad(now.getMinutes(), 2) +
    pad(now.getSeconds(), 2)
  )
}

const DEFAULT_GRAPH = {
  entryNodeId: 'trigger-1',
  nodes: [
    {
      id: 'trigger-1',
      type: 'manual-trigger',
      position: { x: 80, y: 200 },
      data: { label: '手动触发' },
    },
    {
      id: 'end-1',
      type: 'end',
      position: { x: 320, y: 200 },
      data: { label: '结束' },
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-1', target: 'end-1' }],
}

function toSummary(doc: Record<string, unknown>, hasRunningExecution = false) {
  return {
    id: docId(doc),
    name: doc.name as string,
    description: (doc.description as string) ?? '',
    status: doc.status as string,
    version: (doc.version as string) ?? '',
    publishId: (doc.publishId as string) ?? null,
    publishedVersion: (doc.publishedVersion as string) ?? null,
    hasRunningExecution,
    updatedAt: (doc.updatedAt as Date)?.toISOString?.() ?? String(doc.updatedAt),
    createdAt: (doc.createdAt as Date)?.toISOString?.() ?? String(doc.createdAt),
  }
}

function toNodeRecord(doc: Record<string, unknown>) {
  return {
    nodeId: doc.nodeId as string,
    nodeType: doc.nodeType as string,
    nodeName: doc.nodeName as string,
    status: doc.status as string,
    startedAt: doc.startedAt ? new Date(doc.startedAt as string).toISOString() : undefined,
    finishedAt: doc.finishedAt ? new Date(doc.finishedAt as string).toISOString() : undefined,
    durationMs: doc.durationMs as number | undefined,
    input: doc.input,
    output: doc.output,
    error: doc.error as string | undefined,
  }
}

function toExecution(doc: Record<string, unknown>) {
  return {
    id: docId(doc),
    workflowId: refId(doc.workflowId) ?? '',
    workflowName: doc.workflowName as string,
    versionId: (doc.versionId as string) ?? null,
    version: (doc.version as string) ?? '',
    status: doc.status as string,
    trigger: doc.trigger as string,
    startedAt: new Date(doc.startedAt as string).toISOString(),
    finishedAt: doc.finishedAt ? new Date(doc.finishedAt as string).toISOString() : undefined,
    durationMs: doc.durationMs as number | undefined,
    nodeRecords: ((doc.nodeRecords as Record<string, unknown>[]) ?? []).map(toNodeRecord),
    error: doc.error as string | undefined,
  }
}

export async function listAgentWorkflows(userId: string) {
  const items = await AgentWorkflowModel.find({ createdBy: userId })
    .sort({ updatedAt: -1 })
    .lean()

  // 批量查询每个工作流是否有执行中的实例
  const workflowIds = items.map((d) => (d as unknown as Record<string, unknown>)._id)
  const runningExecs = await AgentWorkflowExecutionModel.find({
    workflowId: { $in: workflowIds },
    status: 'running',
  })
    .select('workflowId')
    .lean()
  const runningSet = new Set(
    runningExecs.map((r) => String((r as unknown as Record<string, unknown>).workflowId)),
  )

  return items.map((d) =>
    toSummary(
      d as unknown as Record<string, unknown>,
      runningSet.has(String((d as unknown as Record<string, unknown>)._id)),
    ),
  )
}

export async function createAgentWorkflow(userId: string, name: string, description = '') {
  const doc = await AgentWorkflowModel.create({
    name,
    description,
    draftGraph: DEFAULT_GRAPH,
    version: generateVersion(),
    versions: [],
    createdBy: userId,
  })
  return toSummary(doc.toJSON() as unknown as Record<string, unknown>)
}

export async function getAgentWorkflow(id: string, userId: string) {
  const doc = await AgentWorkflowModel.findOne({ _id: id, createdBy: userId }).lean()
  if (!doc) return null
  const json = doc as unknown as Record<string, unknown>

  const runningCount = await AgentWorkflowExecutionModel.countDocuments({
    workflowId: toObjectId(id),
    status: 'running',
  })

  return {
    ...toSummary(json, runningCount > 0),
    draftGraph: json.draftGraph,
  }
}

export async function updateAgentWorkflow(
  id: string,
  userId: string,
  patch: { name?: string; description?: string; draftGraph?: Record<string, unknown> },
) {
  // 推入当前状态作为版本快照，再应用变更（与可视化编辑器一致）
  const existing = await AgentWorkflowModel.findOne({ _id: id, createdBy: userId }).lean()
  if (!existing) return null
  const existingJson = existing as unknown as Record<string, unknown>

  const $set: Record<string, unknown> = {}
  if (patch.name !== undefined) $set.name = patch.name
  if (patch.description !== undefined) $set.description = patch.description
  if (patch.draftGraph !== undefined) $set.draftGraph = patch.draftGraph

  // 仅在 draftGraph 变更时推快照 + 升版本号
  const pushVersion =
    patch.draftGraph !== undefined &&
    JSON.stringify(existingJson.draftGraph) !== JSON.stringify(patch.draftGraph)

  const updateOp: Record<string, unknown> = { $set }
  if (pushVersion) {
    const newVersion = generateVersion()
    $set.version = newVersion
    updateOp.$push = {
      versions: {
        version: (existingJson.version as string) ?? '',
        createdAt: new Date(),
        graph: existingJson.draftGraph,
      },
    }
    // 限制版本数量
    const currentVersions = (existingJson.versions as unknown[]) ?? []
    if (currentVersions.length >= MAX_VERSIONS) {
      updateOp.$pop = { versions: -1 }
    }
  }

  const doc = await AgentWorkflowModel.findOneAndUpdate(
    { _id: id, createdBy: userId },
    updateOp,
    { new: true },
  ).lean()
  if (!doc) return null
  const json = doc as unknown as Record<string, unknown>
  return {
    ...toSummary(json),
    draftGraph: json.draftGraph,
  }
}

export async function deleteAgentWorkflow(id: string, userId: string) {
  // 执行中的工作流不允许删除
  const runningCount = await AgentWorkflowExecutionModel.countDocuments({
    workflowId: toObjectId(id),
    status: 'running',
  })
  if (runningCount > 0) {
    throw new Error('该工作流有执行中的实例，不允许删除')
  }
  const result = await AgentWorkflowModel.deleteOne({ _id: id, createdBy: userId })
  return result.deletedCount > 0
}

export async function publishAgentWorkflow(id: string, userId: string) {
  const workflow = await AgentWorkflowModel.findOne({ _id: id, createdBy: userId })
  if (!workflow) return null

  // 复用已有 publishId，保证发布标识稳定；首次发布才生成新 UUID
  const publishId = workflow.publishId ?? uuidv4()
  const publishVersion = workflow.version || generateVersion()
  const graphWithSecrets = ensureWebhookSecretsInGraph(
    workflow.draftGraph as Record<string, unknown>,
  )

  workflow.draftGraph = graphWithSecrets
  workflow.status = 'published'
  workflow.publishId = publishId
  workflow.publishedVersion = publishVersion
  workflow.publishedGraph = graphWithSecrets
  await workflow.save()

  return {
    publishId,
    version: publishVersion,
  }
}

export async function listAgentWorkflowVersions(workflowId: string, userId: string) {
  const workflow = await AgentWorkflowModel.findOne({ _id: workflowId, createdBy: userId }).lean()
  if (!workflow) return null
  const json = workflow as unknown as Record<string, unknown>

  const versions = (json.versions as Array<Record<string, unknown>>) ?? []
  const currentVersion = (json.version as string) ?? ''
  const publishedVersion = (json.publishedVersion as string) ?? null

  const allVersions = [
    {
      version: currentVersion,
      createdAt: (json.updatedAt as Date) ?? new Date(),
      published: publishedVersion === currentVersion,
      current: true,
    },
    ...versions.map((v) => ({
      version: v.version as string,
      createdAt: (v.createdAt as Date) ?? new Date(),
      published: publishedVersion === (v.version as string),
      current: false,
    })),
  ]

  allVersions.sort((a, b) => b.version.localeCompare(a.version))

  return allVersions.map((v) => ({
    version: v.version,
    createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : String(v.createdAt),
    published: v.published,
    current: v.current,
  }))
}

export async function getAgentWorkflowVersion(
  workflowId: string,
  userId: string,
  version: string,
) {
  const workflow = await AgentWorkflowModel.findOne({ _id: workflowId, createdBy: userId }).lean()
  if (!workflow) return null
  const json = workflow as unknown as Record<string, unknown>

  if ((json.version as string) === version) {
    return {
      version,
      graph: json.draftGraph as Record<string, unknown>,
      createdAt: (json.updatedAt as Date)?.toISOString?.() ?? String(json.updatedAt),
      current: true,
    }
  }

  const versions = (json.versions as Array<Record<string, unknown>>) ?? []
  const snapshot = versions.find((v) => (v.version as string) === version)
  if (!snapshot) return null
  return {
    version,
    graph: snapshot.graph as Record<string, unknown>,
    createdAt:
      snapshot.createdAt instanceof Date
        ? (snapshot.createdAt as Date).toISOString()
        : String(snapshot.createdAt),
    current: false,
  }
}

export async function startAgentWorkflowExecution(
  workflowId: string,
  userId: string,
  input: Record<string, unknown> = {},
  opts: { trigger?: 'manual' | 'webhook' | 'chat' } = {},
) {
  const workflow = await AgentWorkflowModel.findOne({ _id: workflowId, createdBy: userId })
  if (!workflow) return null

  // 已发布版本优先用 publishedGraph，否则用 draftGraph（草稿测试执行）
  const usePublished = workflow.status === 'published' && workflow.publishedGraph
  const graph = usePublished ? workflow.publishedGraph : workflow.draftGraph
  const versionId = usePublished ? workflow.publishId ?? null : null
  const version = usePublished
    ? workflow.publishedVersion ?? workflow.version ?? ''
    : workflow.version ?? ''

  const execution = await AgentWorkflowExecutionModel.create({
    workflowId: workflow._id,
    workflowName: workflow.name,
    versionId,
    version,
    status: 'running',
    trigger: opts.trigger ?? 'manual',
    nodeRecords: [],
    triggeredBy: userId,
  })

  const executionId = String(execution._id)

  executeAgentWorkflow({
    executionId,
    graph: graph as unknown as Parameters<typeof executeAgentWorkflow>[0]['graph'],
    input,
  }).catch((err) => {
    logger.error({ msg: '[agentWorkflow] execution failed', executionId, err })
  })

  return toExecution(execution.toJSON() as unknown as Record<string, unknown>)
}

export async function listAgentWorkflowExecutions(
  userId: string,
  opts: { workflowId?: string; page?: number; pageSize?: number } = {},
) {
  const page = opts.page ?? 1
  const pageSize = Math.min(opts.pageSize ?? 20, 100)
  const filter: Record<string, unknown> = { triggeredBy: userId }
  if (opts.workflowId) filter.workflowId = toObjectId(opts.workflowId)

  const [items, total] = await Promise.all([
    AgentWorkflowExecutionModel.find(filter)
      .sort({ startedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    AgentWorkflowExecutionModel.countDocuments(filter),
  ])

  return {
    items: items.map((d) => toExecution(d as unknown as Record<string, unknown>)),
    total,
    page,
    pageSize,
  }
}

export async function getAgentWorkflowExecution(id: string, userId: string) {
  const doc = await AgentWorkflowExecutionModel.findOne({ _id: id, triggeredBy: userId }).lean()
  if (!doc) return null
  return toExecution(doc as unknown as Record<string, unknown>)
}

export async function resumeAgentWorkflowExecution(
  executionId: string,
  userId: string,
  resumeValue: Record<string, unknown>,
) {
  const execution = await AgentWorkflowExecutionModel.findOne({
    _id: executionId,
    triggeredBy: userId,
    status: 'waiting',
  })
  if (!execution) return null

  execution.status = 'running'
  await execution.save()

  const workflow = await AgentWorkflowModel.findById(execution.workflowId)
  if (!workflow) return null

  // 恢复时使用与首次执行相同的 graph 来源
  const usePublished = execution.versionId != null && workflow.publishedGraph
  const graph = usePublished ? workflow.publishedGraph : workflow.draftGraph

  executeAgentWorkflow({
    executionId,
    graph: graph as unknown as Parameters<typeof executeAgentWorkflow>[0]['graph'],
    input: resumeValue,
    resumeFromWaiting: true,
  }).catch((err) => {
    logger.error({ msg: '[agentWorkflow] resume failed', executionId, err })
  })

  return getAgentWorkflowExecution(executionId, userId)
}

interface WebhookGraphNode {
  id: string
  type: string
  data?: {
    webhookPath?: string
    webhookMethod?: string
    webhookSecret?: string
  }
}

interface WebhookGraph {
  entryNodeId?: string
  nodes?: WebhookGraphNode[]
}

function normalizeWebhookPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '/') return '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

export async function findPublishedWorkflowByWebhook(path: string, method: string) {
  const normalizedPath = normalizeWebhookPath(path)
  const normalizedMethod = method.toUpperCase()

  const workflows = await AgentWorkflowModel.find({ status: 'published' }).lean()
  for (const workflow of workflows) {
    const graph = workflow.publishedGraph as WebhookGraph | null
    if (!graph?.nodes?.length) continue

    for (const node of graph.nodes) {
      if (node.type !== 'webhook-trigger') continue
      const nodePath = normalizeWebhookPath(String(node.data?.webhookPath ?? '/hook'))
      const nodeMethod = String(node.data?.webhookMethod ?? 'POST').toUpperCase()
      if (nodePath === normalizedPath && nodeMethod === normalizedMethod) {
        return {
          workflowId: String(workflow._id),
          workflowName: workflow.name as string,
          createdBy: workflow.createdBy as string,
          entryNodeId: graph.entryNodeId ?? node.id,
          nodeId: node.id,
          webhookSecret: node.data?.webhookSecret?.trim() || undefined,
        }
      }
    }
  }
  return null
}

// 保持向后兼容（旧测试引用）
export { mongoose as _mongoose }
