/**
 * Flow 共享业务逻辑层。
 *
 * MCP Server 和 LangGraph 工具共同调用，消除重复代码。
 */

import { FlowDefinitionModel } from '../../flow-models/FlowDefinition.js'
import { FlowVersionModel } from '../../flow-models/FlowVersion.js'
import { UserModel } from '../../models/User.js'
import { escapeRegex } from '../graph/agentBase.js'

// ────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────

export interface SearchFlowsParams {
  keyword?: string
  status?: 'draft' | 'published' | 'archived'
  category?: string
  limit?: number
}

export interface FlowSummary {
  id: string
  name: string
  description?: string
  category?: string
  status: string
  currentVersionId?: string
  createdBy?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface FlowDetail {
  id: string
  name: string
  description?: string
  category?: string
  status: string
  createdBy?: string
  graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null
  createdAt?: Date
  updatedAt?: Date
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ────────────────────────────────────────────
// 搜索
// ────────────────────────────────────────────

export async function searchFlows(params: SearchFlowsParams): Promise<{
  success: boolean
  data: { total: number; flows: FlowSummary[] }
  summary: string
}> {
  const { keyword, status, category, limit = 10 } = params

  const filter: Record<string, unknown> = {}
  if (keyword) {
    filter.$or = [
      { name: { $regex: escapeRegex(keyword), $options: 'i' } },
      { description: { $regex: escapeRegex(keyword), $options: 'i' } },
    ]
  }
  if (status) filter.status = status
  if (category) filter.category = category

  const flows = await FlowDefinitionModel.find(filter)
    .select('_id name description category status currentVersionId createdBy createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean() as Record<string, unknown>[]

  const mapped: FlowSummary[] = flows.map((f) => ({
    id: f._id as string,
    name: f.name as string,
    description: f.description as string | undefined,
    category: f.category as string | undefined,
    status: f.status as string,
    currentVersionId: f.currentVersionId as string | undefined,
    createdBy: f.createdBy as string | undefined,
    createdAt: f.createdAt as Date,
    updatedAt: f.updatedAt as Date,
  }))

  const summary = mapped.length === 0
    ? `没有找到${keyword ? `包含"${keyword}"的` : ''}流程`
    : `找到 ${mapped.length} 个流程：${mapped.slice(0, 3).map((f) => `${f.name}（${f.status}）`).join('、')}${mapped.length > 3 ? '等' : ''}`

  return { success: true, data: { total: mapped.length, flows: mapped }, summary }
}

// ────────────────────────────────────────────
// 详情
// ────────────────────────────────────────────

export async function getFlowDetail(flowId: string): Promise<{
  success: boolean
  data?: FlowDetail
  summary?: string
  error?: string
}> {
  const definition = await FlowDefinitionModel.findById(flowId).lean() as Record<string, unknown> | null
  if (!definition) {
    return { success: false, error: `Flow definition ${flowId} 不存在` }
  }

  let graph: Record<string, unknown> | null = null
  if (definition.currentVersionId) {
    const version = await FlowVersionModel.findById(definition.currentVersionId as string).lean() as Record<string, unknown> | null
    if (version) {
      graph = version.graph as Record<string, unknown>
    }
  }

  const nodeCount = graph ? ((graph.nodes as unknown[])?.length ?? 0) : 0
  const edgeCount = graph ? ((graph.edges as unknown[])?.length ?? 0) : 0

  return {
    success: true,
    data: {
      id: definition._id as string,
      name: definition.name as string,
      description: definition.description as string | undefined,
      category: definition.category as string | undefined,
      status: definition.status as string,
      createdBy: definition.createdBy as string | undefined,
      graph: graph as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null,
      createdAt: definition.createdAt as Date,
      updatedAt: definition.updatedAt as Date,
    },
    summary: `流程 "${definition.name}"（${definition.status}）包含 ${nodeCount} 个节点、${edgeCount} 条边`,
  }
}

// ────────────────────────────────────────────
// 用户搜索
// ────────────────────────────────────────────

export async function searchUsers(params: {
  keyword?: string
  role?: string
  limit?: number
}): Promise<{
  success: boolean
  data: { total: number; users: Array<{ id: string; username: string; displayName?: string; roles?: string[] }> }
  summary: string
}> {
  const { keyword, role, limit = 20 } = params

  const filter: Record<string, unknown> = {}
  if (keyword) {
    filter.$or = [
      { username: { $regex: escapeRegex(keyword), $options: 'i' } },
      { displayName: { $regex: escapeRegex(keyword), $options: 'i' } },
    ]
  }
  if (role) {
    filter.roles = role
  }

  const users = await UserModel.find(filter)
    .select('_id username displayName roles')
    .sort({ username: 1 })
    .limit(limit)
    .lean() as Record<string, unknown>[]

  const mapped = users.map((u) => ({
    id: u._id as string,
    username: u.username as string,
    displayName: u.displayName as string | undefined,
    roles: u.roles as string[] | undefined,
  }))

  const summary = mapped.length === 0
    ? `没有找到${keyword ? `包含"${keyword}"的` : ''}用户`
    : `找到 ${mapped.length} 个用户：${mapped.slice(0, 5).map((u) => `${u.displayName || u.username}`).join('、')}${mapped.length > 5 ? '等' : ''}`

  return { success: true, data: { total: mapped.length, users: mapped }, summary }
}

// ────────────────────────────────────────────
// FlowGraph 校验
// ────────────────────────────────────────────

export function validateFlowGraph(flow: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }): ValidationResult {
  const errors: string[] = []
  const nodeIds = new Set(flow.nodes.map((n) => n.id))

  if (flow.nodes.length === 0) {
    errors.push('流程至少需要一个节点')
    return { valid: false, errors }
  }

  const hasStart = flow.nodes.some((n) => (n.data as Record<string, unknown>)?.bpmnType === 'startEvent')
  const hasEnd = flow.nodes.some((n) => (n.data as Record<string, unknown>)?.bpmnType === 'endEvent')
  if (!hasStart) errors.push('缺少 startEvent 开始节点')
  if (!hasEnd) errors.push('缺少 endEvent 结束节点')

  for (const edge of flow.edges) {
    const source = edge.source as Record<string, unknown> | undefined
    const target = edge.target as Record<string, unknown> | undefined
    if (source?.cell && !nodeIds.has(source.cell as string)) errors.push(`边 ${edge.id} 的源节点 ${source.cell} 不存在`)
    if (target?.cell && !nodeIds.has(target.cell as string)) errors.push(`边 ${edge.id} 的目标节点 ${target.cell} 不存在`)
  }

  for (const node of flow.nodes) {
    const data = node.data as Record<string, unknown> | undefined
    if (data?.bpmnType === 'exclusiveGateway' && data.gatewayDirection === 'diverging') {
      const outEdges = flow.edges.filter((e) => {
        const source = e.source as Record<string, unknown> | undefined
        return source?.cell === node.id
      })
      if (outEdges.length >= 2) {
        const hasDefault = !!data.defaultFlow
        const allHaveConditions = outEdges.every((e) => {
          const edgeData = e.data as Record<string, unknown> | undefined
          return edgeData?.conditionExpression || edgeData?.isDefault
        })
        if (!hasDefault && !allHaveConditions) {
          errors.push(`排他网关 "${node.id}" 出边 >= 2 但缺少 defaultFlow 或条件表达式`)
        }
      }
    }

    if (data?.bpmnType === 'userTask') {
      const hasAssignee = data.candidateUsers || data.candidateRoles || data.assignee || data.assigneeCollection
      if (!hasAssignee) {
        errors.push(`用户任务 "${(data.label as string) || (node.id as string)}" 缺少指派人配置`)
      }
    }

    if (data?.bpmnType === 'timerEvent') {
      if (!data.timerType || !data.timerValue) {
        errors.push(`定时事件 "${(data.label as string) || (node.id as string)}" 缺少 timerType 或 timerValue`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
