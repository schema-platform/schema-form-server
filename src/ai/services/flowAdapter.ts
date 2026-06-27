/**
 * Flow 适配层 — 将 AI 生成的简化 FlowGraph 转换为引擎完整的 FlowGraph。
 *
 * AI LLM 输出的 FlowGraph 缺少 shape、完整 BpmnNodeConfig 等字段。
 * 适配器负责：
 * 1. 补全 shape 字段（bpmn-node / bpmn-edge）
 * 2. 补全 BpmnNodeConfig 默认值（approvalMode、rejectPolicy 等）
 * 3. 补全 edge 格式（source/target 改为 { cell } 结构）
 * 4. 自动布局（缺失位置时）
 */

// ────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────

interface PartialFlowNode {
  id: string
  shape?: string
  bpmnType?: string
  label?: string
  x?: number
  y?: number
  width?: number
  height?: number
  data?: Record<string, unknown>
  [key: string]: unknown
}

interface PartialFlowEdge {
  id: string
  shape?: string
  source: string | { cell: string }
  target: string | { cell: string }
  label?: string
  conditionExpression?: string
  isDefault?: boolean
  data?: Record<string, unknown>
  [key: string]: unknown
}

export interface PartialFlowGraph {
  nodes: PartialFlowNode[]
  edges: PartialFlowEdge[]
}

interface AdaptedFlowNode {
  id: string
  shape: string
  x: number
  y: number
  width: number
  height: number
  data: Record<string, unknown>
}

interface AdaptedFlowEdge {
  id: string
  shape: string
  source: { cell: string }
  target: { cell: string }
  data: Record<string, unknown>
}

export interface AdaptedFlowGraph {
  nodes: AdaptedFlowNode[]
  edges: AdaptedFlowEdge[]
}

// ────────────────────────────────────────────
// 默认尺寸
// ────────────────────────────────────────────

const DEFAULT_SIZES: Record<string, { width: number; height: number }> = {
  startEvent: { width: 40, height: 40 },
  endEvent: { width: 40, height: 40 },
  timerEvent: { width: 40, height: 40 },
  messageEvent: { width: 40, height: 40 },
  signalEvent: { width: 40, height: 40 },
  errorEvent: { width: 40, height: 40 },
  userTask: { width: 200, height: 80 },
  serviceTask: { width: 200, height: 80 },
  scriptTask: { width: 200, height: 80 },
  sendTask: { width: 200, height: 80 },
  receiveTask: { width: 200, height: 80 },
  manualTask: { width: 200, height: 80 },
  businessRuleTask: { width: 200, height: 80 },
  exclusiveGateway: { width: 50, height: 50 },
  parallelGateway: { width: 50, height: 50 },
  inclusiveGateway: { width: 50, height: 50 },
  eventBasedGateway: { width: 50, height: 50 },
  complexGateway: { width: 50, height: 50 },
  subProcess: { width: 400, height: 250 },
  callActivity: { width: 200, height: 80 },
}

// ────────────────────────────────────────────
// 适配器
// ────────────────────────────────────────────

/**
 * 将 AI 输出的 PartialFlowGraph 转换为完整的 AdaptedFlowGraph。
 */
export function adaptFlowGraph(partial: PartialFlowGraph): AdaptedFlowGraph {
  const nodes = partial.nodes.map((n) => adaptNode(n))
  const edges = partial.edges.map((e) => adaptEdge(e))

  // 自动布局（如果节点位置缺失或全为 0）
  autoLayout(nodes)

  return { nodes, edges }
}

function adaptNode(partial: PartialFlowNode): AdaptedFlowNode {
  const bpmnType = partial.bpmnType ?? (partial.data?.bpmnType as string) ?? 'userTask'
  const label = partial.label ?? (partial.data?.label as string) ?? bpmnType
  const size = DEFAULT_SIZES[bpmnType] ?? { width: 200, height: 80 }

  // 合并 data 字段
  const data: Record<string, unknown> = {
    bpmnType,
    label,
    ...partial.data,
  }

  // 补全 userTask 默认值
  if (bpmnType === 'userTask') {
    if (!data.approvalMode) data.approvalMode = 'single'
    if (!data.rejectPolicy) data.rejectPolicy = 'reject-on-any'
    if (!data.assigneeType) data.assigneeType = 'user'
    if (!data.candidateUsers) data.candidateUsers = []
    if (!data.candidateRoles) data.candidateRoles = []
  }

  // 补全 exclusiveGateway 默认值
  if (bpmnType === 'exclusiveGateway') {
    if (!data.gatewayDirection) data.gatewayDirection = 'diverging'
  }

  return {
    id: partial.id,
    shape: partial.shape ?? 'bpmn-node',
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? size.width,
    height: partial.height ?? size.height,
    data,
  }
}

function adaptEdge(partial: PartialFlowEdge): AdaptedFlowEdge {
  // source/target 统一为 { cell } 结构
  const source = typeof partial.source === 'string'
    ? { cell: partial.source }
    : partial.source

  const target = typeof partial.target === 'string'
    ? { cell: partial.target }
    : partial.target

  const data: Record<string, unknown> = {
    ...partial.data,
  }

  // 从顶层字段合并到 data
  if (partial.label && !data.label) data.label = partial.label
  if (partial.conditionExpression && !data.conditionExpression) {
    data.conditionExpression = partial.conditionExpression
  }
  if (partial.isDefault !== undefined && !data.isDefault) data.isDefault = partial.isDefault

  return {
    id: partial.id,
    shape: partial.shape ?? 'bpmn-edge',
    source,
    target,
    data,
  }
}

/**
 * 自动布局：为位置全为 0 的节点生成合理的位置。
 */
function autoLayout(nodes: AdaptedFlowNode[]): void {
  // 如果所有节点都有有效位置，跳过
  if (nodes.every((n) => n.x > 0 || n.y > 0)) return

  const H_GAP = 250
  const V_GAP = 120
  let currentX = 50
  let currentY = 150

  for (const node of nodes) {
    if (node.x === 0 && node.y === 0) {
      node.x = currentX
      node.y = currentY
      currentX += H_GAP

      if (currentX > 1000) {
        currentX = 50
        currentY += V_GAP + node.height
      }
    }
  }
}
