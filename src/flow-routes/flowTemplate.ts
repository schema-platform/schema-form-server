import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { FlowTemplateModel } from '../flow-models/FlowTemplate.js'
import { FlowDefinitionModel } from '../flow-models/FlowDefinition.js'
import { FlowVersionModel } from '../flow-models/FlowVersion.js'
import { authMiddleware } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import {
  createFlowTemplateSchema,
  updateFlowTemplateSchema,
  applyFlowTemplateSchema,
} from '../flow-schemas/flowTemplateSchemas.js'
import { BpmnElementType } from '@schema-form/flow-shared'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/flow-templates' })

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ────────────────────────────────────────────
// Built-in templates data
// ────────────────────────────────────────────

interface FlowNodeData {
  id: string
  shape: string
  x: number
  y: number
  width: number
  height: number
  data: Record<string, unknown>
}

interface FlowEdgeData {
  id: string
  shape: string
  source: { cell: string; port?: string }
  target: { cell: string; port?: string }
  data: Record<string, unknown>
}

function makeStartNode(id: string, x: number, y: number): FlowNodeData {
  return {
    id,
    shape: 'bpmn-start-event',
    x,
    y,
    width: 200,
    height: 44,
    data: { bpmnType: BpmnElementType.StartEvent, label: '开始' },
  }
}

function makeEndNode(id: string, x: number, y: number): FlowNodeData {
  return {
    id,
    shape: 'bpmn-end-event',
    x,
    y,
    width: 200,
    height: 44,
    data: { bpmnType: BpmnElementType.EndEvent, label: '结束' },
  }
}

function makeUserTaskNode(
  id: string,
  label: string,
  x: number,
  y: number,
  assigneeType: 'user' | 'role' | 'expression' = 'user',
  assignee = '',
): FlowNodeData {
  return {
    id,
    shape: 'bpmn-user-task',
    x,
    y,
    width: 200,
    height: 48,
    data: {
      bpmnType: BpmnElementType.UserTask,
      label,
      assigneeType,
      assignee,
      approvalMode: 'single',
      rejectPolicy: 'reject-on-any',
    },
  }
}

function makeGatewayNode(
  id: string,
  label: string,
  x: number,
  y: number,
): FlowNodeData {
  return {
    id,
    shape: 'bpmn-exclusive-gateway',
    x,
    y,
    width: 48,
    height: 48,
    data: {
      bpmnType: BpmnElementType.ExclusiveGateway,
      label,
      gatewayDirection: 'diverging',
    },
  }
}

function makeEdge(id: string, source: string, target: string, label?: string): FlowEdgeData {
  return {
    id,
    shape: 'bpmn-sequence-flow',
    source: { cell: source },
    target: { cell: target },
    data: { label: label ?? '' },
  }
}

function buildLeaveApprovalGraph(): { nodes: FlowNodeData[]; edges: FlowEdgeData[] } {
  const nodes = [
    makeStartNode('start', 100, 178),
    makeUserTaskNode('dept-approve', '部门经理审批', 340, 176, 'role', 'department_manager'),
    makeUserTaskNode('hr-approve', 'HR 审批', 580, 176, 'role', 'hr'),
    makeEndNode('end', 820, 178),
  ]
  const edges = [
    makeEdge('e1', 'start', 'dept-approve'),
    makeEdge('e2', 'dept-approve', 'hr-approve'),
    makeEdge('e3', 'hr-approve', 'end'),
  ]
  return { nodes, edges }
}

function buildExpenseApprovalGraph(): { nodes: FlowNodeData[]; edges: FlowEdgeData[] } {
  const nodes = [
    makeStartNode('start', 100, 178),
    makeUserTaskNode('submit', '提交报销单', 340, 176, 'user', ''),
    makeGatewayNode('gw-amount', '金额判断', 580, 176),
    makeUserTaskNode('manager-approve', '经理审批', 668, 76, 'role', 'manager'),
    makeUserTaskNode('finance-approve', '财务审批', 668, 276, 'role', 'finance'),
    makeEndNode('end', 908, 178),
  ]
  const edges = [
    makeEdge('e1', 'start', 'submit'),
    makeEdge('e2', 'submit', 'gw-amount'),
    makeEdge('e3', 'gw-amount', 'manager-approve', '金额 > 5000'),
    makeEdge('e4', 'gw-amount', 'finance-approve', '金额 <= 5000'),
    makeEdge('e5', 'manager-approve', 'finance-approve'),
    makeEdge('e6', 'finance-approve', 'end'),
  ]
  return { nodes, edges }
}

function buildPurchaseApprovalGraph(): { nodes: FlowNodeData[]; edges: FlowEdgeData[] } {
  const nodes = [
    makeStartNode('start', 100, 178),
    makeUserTaskNode('dept-apply', '部门申请', 340, 176, 'user', ''),
    makeUserTaskNode('dept-approve', '部门经理审批', 580, 176, 'role', 'department_manager'),
    makeGatewayNode('gw-amount', '金额判断', 820, 176),
    makeUserTaskNode('vp-approve', 'VP 审批', 908, 76, 'role', 'vp'),
    makeUserTaskNode('finance-confirm', '财务确认', 908, 276, 'role', 'finance'),
    makeEndNode('end', 1148, 178),
  ]
  const edges = [
    makeEdge('e1', 'start', 'dept-apply'),
    makeEdge('e2', 'dept-apply', 'dept-approve'),
    makeEdge('e3', 'dept-approve', 'gw-amount'),
    makeEdge('e4', 'gw-amount', 'vp-approve', '金额 > 10000'),
    makeEdge('e5', 'gw-amount', 'finance-confirm', '金额 <= 10000'),
    makeEdge('e6', 'vp-approve', 'finance-confirm'),
    makeEdge('e7', 'finance-confirm', 'end'),
  ]
  return { nodes, edges }
}

function buildOnboardingGraph(): { nodes: FlowNodeData[]; edges: FlowEdgeData[] } {
  const nodes = [
    makeStartNode('start', 100, 178),
    makeUserTaskNode('hr-init', 'HR 发起入职', 340, 176, 'role', 'hr'),
    makeUserTaskNode('it-setup', 'IT 配置账号', 580, 76, 'role', 'it'),
    makeUserTaskNode('admin-setup', '行政准备工位', 580, 276, 'role', 'admin'),
    makeUserTaskNode('manager-confirm', '部门经理确认', 820, 176, 'role', 'department_manager'),
    makeEndNode('end', 1060, 178),
  ]
  const edges = [
    makeEdge('e1', 'start', 'hr-init'),
    makeEdge('e2', 'hr-init', 'it-setup'),
    makeEdge('e3', 'hr-init', 'admin-setup'),
    makeEdge('e4', 'it-setup', 'manager-confirm'),
    makeEdge('e5', 'admin-setup', 'manager-confirm'),
    makeEdge('e6', 'manager-confirm', 'end'),
  ]
  return { nodes, edges }
}

function buildResignationGraph(): { nodes: FlowNodeData[]; edges: FlowEdgeData[] } {
  const nodes = [
    makeStartNode('start', 100, 178),
    makeUserTaskNode('employee-submit', '员工提交离职', 340, 176, 'user', ''),
    makeUserTaskNode('dept-approve', '部门经理审批', 580, 176, 'role', 'department_manager'),
    makeUserTaskNode('hr-handover', 'HR 办理交接', 820, 76, 'role', 'hr'),
    makeUserTaskNode('it-revoke', 'IT 回收权限', 820, 276, 'role', 'it'),
    makeUserTaskNode('finance-settle', '财务结算', 1060, 176, 'role', 'finance'),
    makeEndNode('end', 1300, 178),
  ]
  const edges = [
    makeEdge('e1', 'start', 'employee-submit'),
    makeEdge('e2', 'employee-submit', 'dept-approve'),
    makeEdge('e3', 'dept-approve', 'hr-handover'),
    makeEdge('e4', 'dept-approve', 'it-revoke'),
    makeEdge('e5', 'hr-handover', 'finance-settle'),
    makeEdge('e6', 'it-revoke', 'finance-settle'),
    makeEdge('e7', 'finance-settle', 'end'),
  ]
  return { nodes, edges }
}

const BUILTIN_TEMPLATES = [
  {
    name: '请假审批',
    description: '标准请假审批流程：员工提交 → 部门经理审批 → HR 备案',
    category: '人事',
    tags: ['请假', '人事', '审批'],
    graph: buildLeaveApprovalGraph(),
  },
  {
    name: '报销审批',
    description: '费用报销流程：提交报销 → 金额判断 → 经理/财务审批',
    category: '财务',
    tags: ['报销', '财务', '审批'],
    graph: buildExpenseApprovalGraph(),
  },
  {
    name: '采购审批',
    description: '采购申请流程：部门申请 → 经理审批 → 金额分级审批 → 财务确认',
    category: '采购',
    tags: ['采购', '审批', '财务'],
    graph: buildPurchaseApprovalGraph(),
  },
  {
    name: '入职审批',
    description: '新员工入职流程：HR 发起 → IT/行政并行准备 → 经理确认',
    category: '人事',
    tags: ['入职', '人事', '并行'],
    graph: buildOnboardingGraph(),
  },
  {
    name: '离职审批',
    description: '员工离职流程：提交离职 → 经理审批 → HR/IT 并行处理 → 财务结算',
    category: '人事',
    tags: ['离职', '人事', '并行'],
    graph: buildResignationGraph(),
  },
]

// ────────────────────────────────────────────
// GET /api/flow-templates
// Lists templates with optional search/category filters and pagination.
// ────────────────────────────────────────────
router.get('/', async (ctx) => {
  const {
    search,
    category,
    isBuiltin,
    page: pageStr = '1',
    pageSize: pageSizeStr = '20',
  } = ctx.query

  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = {}

  if (search) {
    filter.$or = [
      { name: { $regex: escapeRegex(search as string), $options: 'i' } },
      { description: { $regex: escapeRegex(search as string), $options: 'i' } },
    ]
  }

  if (category) {
    filter.category = category
  }

  if (isBuiltin !== undefined) {
    filter.isBuiltin = isBuiltin === 'true'
  }

  const [items, total] = await Promise.all([
    FlowTemplateModel.find(filter).skip(skip).limit(pageSize).sort({ isBuiltin: -1, createdAt: -1 }),
    FlowTemplateModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  }
})

// ────────────────────────────────────────────
// POST /api/flow-templates
// Create a new template.
// ────────────────────────────────────────────
router.post('/', requireAuth, validate(createFlowTemplateSchema), async (ctx) => {
  const { name, description, category, graph, thumbnail, tags, isBuiltin } = ctx.request.body as {
    name: string
    description?: string
    category?: string
    graph: { nodes: unknown[]; edges: unknown[] }
    thumbnail?: string
    tags?: string[]
    isBuiltin?: boolean
  }

  const user = ctx.state.user as { id?: string } | undefined

  const template = await FlowTemplateModel.create({
    _id: uuidv4(),
    name: name.trim(),
    description: description ?? '',
    category: category ?? 'other',
    graph,
    thumbnail: thumbnail ?? '',
    tags: tags ?? [],
    isBuiltin: isBuiltin ?? false,
    createdBy: user?.id ?? '',
  })

  ctx.status = 201
  ctx.body = { success: true, data: template }
})

// ────────────────────────────────────────────
// POST /api/flow-templates/seed
// Seed built-in templates (idempotent — skips if name already exists).
// ────────────────────────────────────────────
router.post('/seed', requireAuth, async (ctx) => {
  const results = { created: 0, updated: 0 }

  for (const tpl of BUILTIN_TEMPLATES) {
    const existing = await FlowTemplateModel.findOne({ name: tpl.name, isBuiltin: true })
    if (existing) {
      // 更新已有内置模板的 graph 数据（确保节点坐标同步最新）
      await FlowTemplateModel.updateOne(
        { _id: existing._id },
        { $set: { graph: tpl.graph, description: tpl.description, category: tpl.category, tags: tpl.tags } },
      )
      results.updated++
      continue
    }
    await FlowTemplateModel.create({
      _id: uuidv4(),
      ...tpl,
      isBuiltin: true,
      createdBy: 'system',
    })
    results.created++
  }

  ctx.body = { success: true, data: results }
})

// ────────────────────────────────────────────
// GET /api/flow-templates/:id
// Get a single template by ID.
// ────────────────────────────────────────────
router.get('/:id', async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const template = await FlowTemplateModel.findById(id)

  if (!template) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Template not found.' } }
    return
  }

  ctx.body = { success: true, data: template }
})

// ────────────────────────────────────────────
// PUT /api/flow-templates/:id
// Update a template.
// ────────────────────────────────────────────
router.put('/:id', requireAuth, validate(updateFlowTemplateSchema), async (ctx) => {
  const { id } = ctx.params
  const body = ctx.request.body as Record<string, unknown>

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await FlowTemplateModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Template not found.' } }
    return
  }

  if (body.name !== undefined && typeof body.name === 'string') {
    body.name = body.name.trim()
  }

  const template = await FlowTemplateModel.findByIdAndUpdate(id, body, { new: true })

  ctx.body = { success: true, data: template }
})

// ────────────────────────────────────────────
// DELETE /api/flow-templates/:id
// Delete a template (built-in templates cannot be deleted).
// ────────────────────────────────────────────
router.delete('/:id', requireAuth, async (ctx) => {
  const { id } = ctx.params

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const existing = await FlowTemplateModel.findById(id)
  if (!existing) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Template not found.' } }
    return
  }

  if (existing.isBuiltin) {
    ctx.status = 403
    ctx.body = { success: false, error: { message: 'Built-in templates cannot be deleted.' } }
    return
  }

  await FlowTemplateModel.findByIdAndDelete(id)

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

// ────────────────────────────────────────────
// POST /api/flow-templates/:id/apply
// Apply a template: creates a new FlowDefinition + FlowVersion from the template graph.
// ────────────────────────────────────────────
router.post('/:id/apply', requireAuth, validate(applyFlowTemplateSchema), async (ctx) => {
  const { id } = ctx.params
  const { name, description } = ctx.request.body as {
    name?: string
    description?: string
  }

  if (!uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const template = await FlowTemplateModel.findById(id)
  if (!template) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Template not found.' } }
    return
  }

  const userId = (ctx.state.user as { id: string }).id
  const definitionId = uuidv4()
  const versionId = uuidv4()

  // Regenerate node and edge IDs to avoid collisions
  const idMap = new Map<string, string>()
  const nodes = template.graph.nodes.map((node: Record<string, unknown>) => {
    const newId = uuidv4()
    idMap.set(node.id as string, newId)
    return { ...node, id: newId }
  })
  const edges = template.graph.edges.map((edge: Record<string, unknown>) => ({
    ...edge,
    id: uuidv4(),
    source: { ...(edge.source as Record<string, unknown>), cell: idMap.get((edge.source as Record<string, unknown>).cell as string) ?? (edge.source as Record<string, unknown>).cell },
    target: { ...(edge.target as Record<string, unknown>), cell: idMap.get((edge.target as Record<string, unknown>).cell as string) ?? (edge.target as Record<string, unknown>).cell },
  }))

  const now = new Date()
  const pad = (n: number, len: number) => String(n).padStart(len, '2')
  const nextVersion = `v${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`

  const definition = await FlowDefinitionModel.create({
    _id: definitionId,
    name: name ?? template.name,
    description: description ?? template.description,
    category: template.category,
    status: 'draft',
    createdBy: userId,
    permissions: { editors: [], launchers: [], viewers: [] },
  })

  const version = await FlowVersionModel.create({
    _id: versionId,
    definitionId,
    version: nextVersion,
    graph: { nodes, edges },
    metadata: null,
  })

  definition.currentVersionId = version._id
  await definition.save()

  // Increment template use count
  await FlowTemplateModel.findByIdAndUpdate(id, { $inc: { useCount: 1 } })

  ctx.status = 201
  ctx.body = { success: true, data: definition }
})

// ────────────────────────────────────────────
// POST /api/flow-templates/from-flow/:definitionId
// Save an existing flow definition as a template.
// ────────────────────────────────────────────
router.post('/from-flow/:definitionId', requireAuth, async (ctx) => {
  const { definitionId } = ctx.params
  const { name, description, category, tags, thumbnail } = ctx.request.body as {
    name?: string
    description?: string
    category?: string
    tags?: string[]
    thumbnail?: string
  }

  if (!uuidValidate(definitionId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const definition = await FlowDefinitionModel.findById(definitionId)
  if (!definition) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Flow definition not found.' } }
    return
  }

  // Get the latest version to copy graph data
  const latestVersion = await FlowVersionModel.findOne({ definitionId }).sort({ version: -1 })
  if (!latestVersion) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Flow has no saved versions. Save a version first.' } }
    return
  }

  const user = ctx.state.user as { id?: string } | undefined

  const template = await FlowTemplateModel.create({
    _id: uuidv4(),
    name: name ?? definition.name,
    description: description ?? definition.description,
    category: category ?? definition.category ?? 'other',
    graph: latestVersion.graph,
    thumbnail: thumbnail ?? '',
    tags: tags ?? [],
    isBuiltin: false,
    createdBy: user?.id ?? '',
  })

  ctx.status = 201
  ctx.body = { success: true, data: template }
})

export default router
