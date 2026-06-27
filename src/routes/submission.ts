import Router from '@koa/router'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { FormSubmissionModel } from '../models/FormSubmission.js'
import { FormSchemaModel } from '../models/FormSchema.js'
import { authMiddleware } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import {
  createSubmissionSchema,
  updateSubmissionStatusSchema,
  batchDeleteSubmissionsSchema,
  batchUpdateSubmissionsStatusSchema,
} from '../schemas/submissionSchemas.js'
import { eventBus } from '../services/eventBus.js'
import {
  exportToCsv,
  exportToExcel,
  extractFieldLabels,
  buildExportFields,
  type ExportFormat,
} from '../services/exportService.js'
import type { SubmissionStatus } from '../models/FormSubmission.js'

const requireAuth = authMiddleware({ required: true })

const router = new Router({ prefix: '/api/submissions' })

// ────────────────────────────────────────────
// POST /api/submissions/:schemaId
// 提交表单数据
// ────────────────────────────────────────────
router.post('/:schemaId', requireAuth, validate(createSubmissionSchema), async (ctx) => {
  const { schemaId } = ctx.params
  const { data, submitterId } = ctx.request.body as { data: Record<string, unknown>; submitterId?: string }

  if (!uuidValidate(schemaId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid schemaId UUID format.' } }
    return
  }

  // 验证关联的 schema 存在
  const schema = await FormSchemaModel.findById(schemaId)
  if (!schema) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Form schema not found.' } }
    return
  }

  const userId = (ctx.state.user as { id: string }).id

  const submission = await FormSubmissionModel.create({
    _id: uuidv4(),
    schemaId,
    data,
    submitterId: submitterId ?? userId,
    status: 'submitted',
  })

  ctx.status = 201
  ctx.body = { success: true, data: submission }

  // Fire-and-forget webhook event
  eventBus.emit('submission.created', {
    submissionId: submission._id,
    schemaId,
    data,
  }).catch((err) => console.error('[submission.created] emit failed:', err))
})

// ────────────────────────────────────────────
// GET /api/submissions/:schemaId
// 查询某表单的所有提交（分页 + 状态筛选）
// ────────────────────────────────────────────
router.get('/:schemaId', requireAuth, async (ctx) => {
  const { schemaId } = ctx.params
  const { status, page: pageStr = '1', pageSize: pageSizeStr = '20' } = ctx.query

  if (!uuidValidate(schemaId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid schemaId UUID format.' } }
    return
  }

  const page = Math.max(1, parseInt(pageStr as string, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr as string, 10) || 20))
  const skip = (page - 1) * pageSize

  const filter: Record<string, unknown> = { schemaId }
  if (status && ['submitted', 'approved', 'rejected'].includes(status as string)) {
    filter.status = status as SubmissionStatus
  }

  const [items, total] = await Promise.all([
    FormSubmissionModel.find(filter).skip(skip).limit(pageSize).sort({ createdAt: -1 }),
    FormSubmissionModel.countDocuments(filter),
  ])

  ctx.body = {
    success: true,
    data: {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  }
})

// ────────────────────────────────────────────
// GET /api/submissions/:schemaId/export
// 导出为 CSV 或 Excel
// 查询参数：status, format (csv | xlsx)
// ────────────────────────────────────────────
router.get('/:schemaId/export', requireAuth, async (ctx) => {
  const { schemaId } = ctx.params
  const { status, format: formatParam } = ctx.query

  if (!uuidValidate(schemaId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid schemaId UUID format.' } }
    return
  }

  const format: ExportFormat = formatParam === 'xlsx' ? 'xlsx' : 'csv'

  const filter: Record<string, unknown> = { schemaId }
  if (status && ['submitted', 'approved', 'rejected'].includes(status as string)) {
    filter.status = status as SubmissionStatus
  }

  const submissions = await FormSubmissionModel.find(filter).sort({ createdAt: -1 })

  if (submissions.length === 0) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'No submissions found to export.' } }
    return
  }

  // 从 Schema JSON 中提取字段 label 映射
  const schema = await FormSchemaModel.findById(schemaId).lean() as Record<string, unknown> | null
  const fieldLabels = schema ? extractFieldLabels(schema.json as Record<string, unknown>) : {}

  // 构建导出字段列表
  const fields = buildExportFields(submissions, fieldLabels)

  const safeName = ((schema?.name as string) ?? schemaId).replace(/[^\w一-鿿-]/g, '_')

  if (format === 'xlsx') {
    const buffer = await exportToExcel(submissions, fields)
    ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    ctx.set('Content-Disposition', `attachment; filename="submissions-${safeName}.xlsx"`)
    ctx.body = buffer
  } else {
    const csv = exportToCsv(submissions, fields)
    ctx.set('Content-Type', 'text/csv; charset=utf-8')
    ctx.set('Content-Disposition', `attachment; filename="submissions-${safeName}.csv"`)
    ctx.body = csv
  }
})

// ────────────────────────────────────────────
// GET /api/submissions/:schemaId/:id
// 查询单条提交详情
// ────────────────────────────────────────────
router.get('/:schemaId/:id', requireAuth, async (ctx) => {
  const { schemaId, id } = ctx.params

  if (!uuidValidate(schemaId) || !uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const submission = await FormSubmissionModel.findOne({ _id: id, schemaId })
  if (!submission) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Submission not found.' } }
    return
  }

  ctx.body = { success: true, data: submission }
})

// ────────────────────────────────────────────
// PATCH /api/submissions/:schemaId/:id/status
// 更新提交状态（审批/驳回）
// ────────────────────────────────────────────
router.patch('/:schemaId/:id/status', requireAuth, validate(updateSubmissionStatusSchema), async (ctx) => {
  const { schemaId, id } = ctx.params
  const { status } = ctx.request.body as { status: SubmissionStatus }

  if (!uuidValidate(schemaId) || !uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const submission = await FormSubmissionModel.findOneAndUpdate(
    { _id: id, schemaId },
    { $set: { status } },
    { new: true },
  )

  if (!submission) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Submission not found.' } }
    return
  }

  ctx.body = { success: true, data: submission }
})

// ────────────────────────────────────────────
// DELETE /api/submissions/:schemaId/:id
// 删除提交
// ────────────────────────────────────────────
router.delete('/:schemaId/:id', requireAuth, async (ctx) => {
  const { schemaId, id } = ctx.params

  if (!uuidValidate(schemaId) || !uuidValidate(id)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid UUID format.' } }
    return
  }

  const result = await FormSubmissionModel.findOneAndDelete({ _id: id, schemaId })
  if (!result) {
    ctx.status = 404
    ctx.body = { success: false, error: { message: 'Submission not found.' } }
    return
  }

  ctx.status = 200
  ctx.body = { success: true, data: null }
})

// ────────────────────────────────────────────
// POST /api/submissions/:schemaId/batch/delete
// 批量删除提交
// ────────────────────────────────────────────
router.post('/:schemaId/batch/delete', requireAuth, validate(batchDeleteSubmissionsSchema), async (ctx) => {
  const { schemaId } = ctx.params
  const { ids } = ctx.request.body as { ids: string[] }

  if (!uuidValidate(schemaId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid schemaId UUID format.' } }
    return
  }

  const result = await FormSubmissionModel.deleteMany({
    _id: { $in: ids },
    schemaId,
  })

  ctx.status = 200
  ctx.body = { success: true, data: { deletedCount: result.deletedCount } }
})

// ────────────────────────────────────────────
// POST /api/submissions/:schemaId/batch/status
// 批量更新提交状态
// ────────────────────────────────────────────
router.post('/:schemaId/batch/status', requireAuth, validate(batchUpdateSubmissionsStatusSchema), async (ctx) => {
  const { schemaId } = ctx.params
  const { ids, status } = ctx.request.body as { ids: string[]; status: SubmissionStatus }

  if (!uuidValidate(schemaId)) {
    ctx.status = 400
    ctx.body = { success: false, error: { message: 'Invalid schemaId UUID format.' } }
    return
  }

  const result = await FormSubmissionModel.updateMany(
    { _id: { $in: ids }, schemaId },
    { $set: { status } },
  )

  ctx.status = 200
  ctx.body = { success: true, data: { modifiedCount: result.modifiedCount } }
})

export default router
