/**
 * Export Service — 数据导出服务
 *
 * 支持 CSV 和 Excel (xlsx) 两种格式的表单提交数据导出。
 * 支持自定义导出字段和字段名映射（来自 Schema label）。
 */
import ExcelJS from 'exceljs'
import type { IFormSubmission } from '../models/FormSubmission.js'

export type ExportFormat = 'csv' | 'xlsx'

export interface ExportField {
  /** 数据 key（对应 submission.data 中的 key 或元数据字段名） */
  key: string
  /** 显示标签（列头） */
  label: string
}

/** 元数据字段：每条提交都有的基础信息 */
const META_FIELDS: ExportField[] = [
  { key: 'id', label: 'ID' },
  { key: 'submitterId', label: '提交者' },
  { key: 'status', label: '状态' },
  { key: 'createdAt', label: '提交时间' },
]

const STATUS_LABELS: Record<string, string> = {
  submitted: '已提交',
  approved: '已通过',
  rejected: '已驳回',
}

/**
 * 从 Schema JSON 中提取字段 label 映射
 * 遍历 widget 树，收集所有 id → label 的映射
 */
export function extractFieldLabels(schemaJson: Record<string, unknown>): Record<string, string> {
  const labels: Record<string, string> = {}

  function walk(node: Record<string, unknown>): void {
    const id = node.id as string | undefined
    const props = node.props as Record<string, unknown> | undefined
    const label = props?.label as string | undefined

    if (id && label) {
      labels[id] = label
    }

    const children = node.children as Record<string, unknown>[] | undefined
    if (Array.isArray(children)) {
      for (const child of children) {
        walk(child)
      }
    }
  }

  // schema json 可能是 { children: [...] } 或直接是数组
  const children = schemaJson.children as Record<string, unknown>[] | undefined
  if (Array.isArray(children)) {
    for (const child of children) {
      walk(child)
    }
  } else if (Array.isArray(schemaJson)) {
    for (const item of schemaJson) {
      walk(item)
    }
  }

  return labels
}

/**
 * 构建导出字段列表
 * 先放元数据字段，再遍历所有 submission 的 data key 去重
 */
export function buildExportFields(
  submissions: IFormSubmission[],
  fieldLabels: Record<string, string>,
): ExportField[] {
  const dataKeys = new Set<string>()
  for (const sub of submissions) {
    for (const key of Object.keys(sub.data)) {
      dataKeys.add(key)
    }
  }

  const dataFields: ExportField[] = Array.from(dataKeys).map((key) => ({
    key,
    label: fieldLabels[key] ?? key,
  }))

  return [...META_FIELDS, ...dataFields]
}

/**
 * 获取某条提交在某字段的值
 */
function getFieldValue(submission: IFormSubmission, fieldKey: string): string {
  if (fieldKey === 'id') return submission._id
  if (fieldKey === 'submitterId') return submission.submitterId ?? ''
  if (fieldKey === 'status') return STATUS_LABELS[submission.status] ?? submission.status
  if (fieldKey === 'createdAt') return submission.createdAt.toISOString()

  const val = submission.data[fieldKey]
  if (val === null || val === undefined) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

/**
 * 导出为 CSV
 */
export function exportToCsv(submissions: IFormSubmission[], fields: ExportField[]): string {
  const escapeCsv = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }

  const headers = fields.map((f) => escapeCsv(f.label))
  const rows = submissions.map((sub) =>
    fields.map((f) => escapeCsv(getFieldValue(sub, f.key))).join(','),
  )

  return [headers.join(','), ...rows].join('\n')
}

/**
 * 导出为 Excel (xlsx)
 * 返回 Buffer，可直接写入 ctx.body
 */
export async function exportToExcel(
  submissions: IFormSubmission[],
  fields: ExportField[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Schema Form Platform'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('提交数据')

  // 设置列定义
  sheet.columns = fields.map((f) => ({
    header: f.label,
    key: f.key,
    width: Math.max(f.label.length * 2, 16),
  }))

  // 表头样式
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF409EFF' },
  }
  headerRow.alignment = { horizontal: 'center' }

  // 填充数据
  for (const sub of submissions) {
    const rowData: Record<string, string> = {}
    for (const field of fields) {
      rowData[field.key] = getFieldValue(sub, field.key)
    }
    sheet.addRow(rowData)
  }

  // 自动筛选
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: fields.length },
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
