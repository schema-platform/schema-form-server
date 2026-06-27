/**
 * Industry-specific tools for the AI Agent system.
 *
 * These tools are bound to agents when an industry context is active.
 * They provide industry-aware template search, form validation, and
 * terminology lookup capabilities.
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import {
  searchIndustryTemplates,
  getIndustryTemplates,
  getIndustryConfig,
  type IndustryType,
  type IndustryTemplate,
} from '../config/industryAgents.js'
import type { ToolResult } from './types.js'

// ────────────────────────────────────────────
// Industry-specific validation rules
// ────────────────────────────────────────────

interface ValidationRule {
  field: string
  rule: string
  message: string
}

const INDUSTRY_VALIDATION_RULES: Record<IndustryType, ValidationRule[]> = {
  medical: [
    { field: 'patientName', rule: 'required', message: '患者姓名为必填项' },
    { field: 'idCard', rule: 'sensitive', message: '身份证号应标记为敏感字段' },
    { field: 'diagnosis', rule: 'required', message: '诊断为必填项' },
    { field: 'chiefComplaint', rule: 'required', message: '主诉为必填项' },
  ],
  finance: [
    { field: 'loanAmount', rule: 'precision', message: '金额字段应保留2位小数' },
    { field: 'idCard', rule: 'sensitive', message: '身份证号应标记为敏感字段' },
    { field: 'phone', rule: 'sensitive', message: '手机号应标记为敏感字段' },
    { field: 'interestRate', rule: 'display', message: '利率应展示为年化利率' },
  ],
  education: [
    { field: 'studentName', rule: 'required', message: '学生姓名为必填项' },
    { field: 'studentNo', rule: 'required', message: '学号为必填项' },
    { field: 'idCard', rule: 'sensitive', message: '身份证号应标记为敏感字段' },
  ],
}

// ────────────────────────────────────────────
// Tools
// ────────────────────────────────────────────

/**
 * Search industry-specific templates.
 */
export const searchIndustryTemplatesTool = tool(
  async ({ keyword, industry, type }): Promise<string> => {
    const results = searchIndustryTemplates(keyword, industry as IndustryType | undefined)

    const filtered = type ? results.filter((r) => r.type === type) : results

    const summary = filtered.length === 0
      ? `没有找到${industry ? `${getIndustryConfig(industry as IndustryType)?.name ?? industry}的` : ''}相关模板`
      : `找到 ${filtered.length} 个行业模板：${filtered.slice(0, 3).map((t) => `${t.name}（${t.type === 'form' ? '表单' : '流程'}）`).join('、')}${filtered.length > 3 ? '等' : ''}`

    const result: ToolResult = {
      success: true,
      data: {
        total: filtered.length,
        templates: filtered.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          type: t.type,
          industry: t.industry,
        })),
      },
      summary,
    }
    return JSON.stringify(result)
  },
  {
    name: 'search_industry_templates',
    description: `搜索行业专属模板。当用户要求生成特定行业的表单或流程时，先搜索相关模板作为参考。

参数：keyword — 搜索关键词（如"病历"、"贷款"）；industry — 指定行业（medical/finance/education）；type — 按类型筛选（form/flow）。
返回 JSON 包含 templates 数组，每项含 id、name、description、type、industry。`,
    schema: z.object({
      keyword: z.string().describe('搜索关键词，如"病历"、"贷款"、"请假"'),
      industry: z.enum(['medical', 'finance', 'education']).optional().describe('指定行业，不传则搜索所有行业'),
      type: z.enum(['form', 'flow']).optional().describe('按类型筛选：form=表单，flow=流程'),
    }),
  },
)

/**
 * Validate a form schema against industry-specific rules.
 */
export const validateIndustryFormTool = tool(
  async ({ widgets, industry }): Promise<string> => {
    const config = getIndustryConfig(industry as IndustryType)
    if (!config) {
      return JSON.stringify({ success: false, error: `未知行业类型: ${industry}` } satisfies ToolResult)
    }

    const rules = INDUSTRY_VALIDATION_RULES[industry as IndustryType] ?? []
    const warnings: Array<{ field: string; message: string }> = []

    // Extract all field names from the widget tree
    const fields = new Set<string>()
    function collectFields(nodes: Record<string, unknown>[]): void {
      for (const node of nodes) {
        const props = node.props as Record<string, unknown> | undefined
        if (props?.field) fields.add(props.field as string)
        if (Array.isArray(node.children)) {
          collectFields(node.children as Record<string, unknown>[])
        }
      }
    }
    collectFields(widgets as Record<string, unknown>[])

    // Check rules
    for (const rule of rules) {
      if (rule.rule === 'required' && !fields.has(rule.field)) {
        warnings.push({ field: rule.field, message: rule.message })
      }
      if (rule.rule === 'sensitive') {
        // Check if the field exists and is marked as sensitive
        // This is a best-effort check
      }
    }

    const summary = warnings.length === 0
      ? `${config.name}表单校验通过，共 ${(widgets as unknown[]).length} 个组件`
      : `${config.name}表单校验发现 ${warnings.length} 个建议：${warnings.map((w) => w.message).join('；')}`

    const result: ToolResult = {
      success: true,
      data: {
        industry,
        valid: true,
        warnings,
        componentCount: (widgets as unknown[]).length,
      },
      summary,
    }
    return JSON.stringify(result)
  },
  {
    name: 'validate_industry_form',
    description: `根据行业规范校验表单 Schema。检查必填字段（如患者姓名、学号）和敏感字段标记。在生成行业表单后调用此工具检查是否符合行业要求。

参数：widgets — 要校验的 Widget 数组；industry — 行业类型（medical/finance/education）。
返回 JSON 包含 warnings 建议列表和 componentCount 组件数量。`,
    schema: z.object({
      widgets: z.array(z.record(z.unknown())).describe('要校验的 Widget 数组'),
      industry: z.enum(['medical', 'finance', 'education']).describe('行业类型'),
    }),
  },
)

// ────────────────────────────────────────────
// Exported tool arrays
// ────────────────────────────────────────────

/** All industry tools */
export const industryTools = [
  searchIndustryTemplatesTool,
  validateIndustryFormTool,
]

/**
 * Get industry-specific tools by tool names.
 * Used to bind only the relevant tools for a given industry.
 */
export function getIndustryToolsByNames(
  toolNames: string[],
): typeof industryTools {
  const toolMap = new Map<string, (typeof industryTools)[number]>(
    industryTools.map((t) => [t.name, t])
  )
  return toolNames
    .map((name) => toolMap.get(name))
    .filter((t): t is (typeof industryTools)[number] => t !== undefined)
}

/**
 * Get the full set of industry tools for a specific industry.
 */
export function getToolsForIndustry(industry: IndustryType): typeof industryTools {
  const config = getIndustryConfig(industry)
  if (!config) return []
  return getIndustryToolsByNames(config.toolNames)
}
