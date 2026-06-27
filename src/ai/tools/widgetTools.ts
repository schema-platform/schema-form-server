/**
 * Widget domain knowledge and validation — LangGraph StructuredTool format.
 *
 * 使用共享 toolHandlers 层，与 MCP 工具共用同一份业务逻辑。
 */

import { tool } from '@langchain/core/tools'
import { getMetadata, handleWidgetQuery, handleWidgetValidate } from './toolHandlers.js'
import { z } from 'zod'

// ────────────────────────────────────────────
// Backward-compatible wrappers
// ────────────────────────────────────────────

export function queryWidgets(category?: string) {
  const result = handleWidgetQuery(category)
  return { total: (result.data as { total: number }).total, widgets: (result.data as { widgets: unknown[] }).widgets }
}

export async function validateSchema(widgets: Record<string, unknown>[]) {
  const result = await handleWidgetValidate(widgets)
  return { valid: (result.data as { valid: boolean }).valid, errors: (result.data as { errors: Array<{ path: string; message: string }> }).errors }
}

// ────────────────────────────────────────────
// LangGraph tools
// ────────────────────────────────────────────

export const queryWidgetsTool = tool(
  async ({ category }): Promise<string> => {
    const result = handleWidgetQuery(category)
    return JSON.stringify(result)
  },
  {
    name: 'query_widgets',
    description: `获取 Widget 组件目录。参数：category — 组件分类，不传返回全部。`,
    schema: z.object({
      category: z.enum(['container', 'layout', 'form', 'static', 'action', 'table', 'business', 'chart'])
        .optional().describe('按组件分类筛选'),
    }),
  },
)

export const validateWidgetSchemaTool = tool(
  async ({ widgets }): Promise<string> => {
    const result = await handleWidgetValidate(widgets as Record<string, unknown>[])
    return JSON.stringify(result)
  },
  {
    name: 'validate_widget_schema',
    description: `校验 Widget Schema JSON 的结构正确性。参数：widgets — 要校验的 Widget 数组。`,
    schema: z.object({
      widgets: z.array(z.record(z.unknown())).describe('要校验的 Widget 数组'),
    }),
  },
)

export const widgetTools = [queryWidgetsTool, validateWidgetSchemaTool]
