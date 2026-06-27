import Router from '@koa/router'
import { ApprovalLogModel } from '../flow-models/ApprovalLog.js'
import { FlowInstanceModel } from '../flow-models/FlowInstance.js'
import { FlowDefinitionModel } from '../flow-models/FlowDefinition.js'
import { TaskInstanceModel } from '../flow-models/TaskInstance.js'
import { authMiddleware } from '../middleware/auth.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/flow-export' })

interface ApprovalLogRow {
  flowName: string
  instanceId: string
  nodeName: string
  taskAssignee: string
  operator: string
  action: string
  outcome: string
  comment: string
  createdAt: string
}

const ACTION_LABELS: Record<string, string> = {
  claim: '签收',
  approve: '通过',
  reject: '驳回',
  delegate: '委派',
  comment: '评论',
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

function generateCsv(rows: ApprovalLogRow[]): string {
  const headers = ['流程名称', '实例ID', '节点名称', '处理人', '操作人', '操作类型', '结果', '备注', '操作时间']
  const headerLine = headers.map(escapeCsvField).join(',')
  const dataLines = rows.map((row) =>
    [
      row.flowName,
      row.instanceId,
      row.nodeName,
      row.taskAssignee,
      row.operator,
      ACTION_LABELS[row.action] ?? row.action,
      row.outcome,
      row.comment,
      row.createdAt,
    ]
      .map(escapeCsvField)
      .join(','),
  )
  // BOM for Excel UTF-8 compatibility
  return '﻿' + [headerLine, ...dataLines].join('\r\n')
}

// GET /api/flow-export/approval-logs
// Query params:
//   flowId    — filter by flow definition ID
//   startDate — ISO date string, filter logs >= this date
//   endDate   — ISO date string, filter logs <= this date
//   format    — 'csv' (default) or 'json'
router.get('/approval-logs', requireAuth, async (ctx) => {
  const { flowId, instanceId, startDate, endDate, format = 'csv' } = ctx.query as Record<string, string | undefined>

  // Single instance export — short-circuit with direct instance filter
  if (instanceId) {
    const instance = await FlowInstanceModel.findOne({ _id: instanceId }).select('_id definitionId')
    if (!instance) {
      ctx.status = 404
      ctx.body = { success: false, error: { message: 'Instance not found' } }
      return
    }
    const logs = await ApprovalLogModel.find({ instanceId }).sort({ createdAt: -1 })
    const def = await FlowDefinitionModel.findOne({ _id: instance.definitionId }).select('_id name')
    const taskIds = [...new Set(logs.map((l) => l.taskId))]
    const tasks = await TaskInstanceModel.find({ _id: { $in: taskIds } }).select('_id assignee')
    const taskAssigneeMap = new Map(tasks.map((t) => [t._id, t.assignee ?? '']))

    const rows: ApprovalLogRow[] = logs.map((log) => ({
      flowName: def?.name ?? '',
      instanceId: log.instanceId,
      nodeName: log.nodeName,
      taskAssignee: taskAssigneeMap.get(log.taskId) ?? '',
      operator: log.operator,
      action: log.action,
      outcome: log.outcome ?? '',
      comment: log.comment ?? '',
      createdAt: new Date(log.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    }))

    if (format === 'json') {
      ctx.body = { success: true, data: rows }
      return
    }
    const csv = generateCsv(rows)
    ctx.set('Content-Type', 'text/csv; charset=utf-8')
    ctx.set('Content-Disposition', `attachment; filename=approval-logs-${instanceId}.csv`)
    ctx.body = csv
    return
  }

  // If filtering by flow, first resolve matching instance IDs
  let instanceIds: string[] | null = null
  if (flowId) {
    const instances = await FlowInstanceModel.find({ definitionId: flowId }).select('_id')
    instanceIds = instances.map((i) => i._id)
    if (instanceIds.length === 0) {
      if (format === 'json') {
        ctx.body = { success: true, data: [] }
      } else {
        ctx.set('Content-Type', 'text/csv; charset=utf-8')
        ctx.set('Content-Disposition', 'attachment; filename=approval-logs.csv')
        ctx.body = '﻿' + '流程名称,实例ID,节点名称,处理人,操作人,操作类型,结果,备注,操作时间\r\n'
      }
      return
    }
  }

  // Build approval log query
  const logQuery: Record<string, unknown> = {}
  if (instanceIds) logQuery.instanceId = { $in: instanceIds }
  if (startDate || endDate) {
    const created: Record<string, Date> = {}
    if (startDate) created.$gte = new Date(startDate)
    if (endDate) created.$lte = new Date(endDate)
    logQuery.createdAt = created
  }

  const logs = await ApprovalLogModel.find(logQuery).sort({ createdAt: -1 })

  // Gather unique IDs for batch lookup
  const uniqueInstanceIds = [...new Set(logs.map((l) => l.instanceId))]
  const uniqueTaskIds = [...new Set(logs.map((l) => l.taskId))]

  // Fetch instances to get definitionIds
  const instances = await FlowInstanceModel.find({ _id: { $in: uniqueInstanceIds } }).select('_id definitionId')
  const instanceToDef = new Map(instances.map((i) => [i._id, i.definitionId]))

  // Fetch flow definitions for names
  const uniqueDefIds = [...new Set([...instanceToDef.values()])]
  const defs = await FlowDefinitionModel.find({ _id: { $in: uniqueDefIds } }).select('_id name')
  const defNameMap = new Map(defs.map((d) => [d._id, d.name]))

  // Fetch tasks for assignee info
  const tasks = await TaskInstanceModel.find({ _id: { $in: uniqueTaskIds } }).select('_id assignee')
  const taskAssigneeMap = new Map(tasks.map((t) => [t._id, t.assignee ?? '']))

  // Build rows
  const rows: ApprovalLogRow[] = logs.map((log) => {
    const defId = instanceToDef.get(log.instanceId)
    return {
      flowName: defId ? (defNameMap.get(defId) ?? '') : '',
      instanceId: log.instanceId,
      nodeName: log.nodeName,
      taskAssignee: taskAssigneeMap.get(log.taskId) ?? '',
      operator: log.operator,
      action: log.action,
      outcome: log.outcome ?? '',
      comment: log.comment ?? '',
      createdAt: new Date(log.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    }
  })

  if (format === 'json') {
    ctx.body = { success: true, data: rows }
    return
  }

  // CSV
  const csv = generateCsv(rows)
  ctx.set('Content-Type', 'text/csv; charset=utf-8')
  ctx.set('Content-Disposition', 'attachment; filename=approval-logs.csv')
  ctx.body = csv
})

export default router
