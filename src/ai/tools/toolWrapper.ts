/**
 * Tool error handling wrapper — 工具级错误兜底。
 *
 * ToolNode 级熔断由 graph.ts 的 allToolNodeWithErrorHandling 提供，
 * 此模块提供工具定义时的可选包装，让工具函数自身捕获异常并返回
 * 结构化错误 JSON，避免异常向上传播。
 *
 * 用法：
 *   const safeTool = wrapTool(originalTool, 'tool_name')
 *   // safeTool.invoke 行为同原工具，但异常被捕获返回 { success: false, error }
 */

import type { StructuredTool, ToolRunnableConfig } from '@langchain/core/tools'
import { logger } from '../../utils/logger.js'

/**
 * 包装单个工具：捕获 invoke 异常，返回结构化错误字符串。
 * 保留原工具的 name/description/schema，仅替换执行逻辑。
 */
export function wrapTool(tool: StructuredTool, toolName?: string): StructuredTool {
  const name = toolName ?? tool.name
  const originalInvoke = tool.invoke.bind(tool)

  const wrappedInvoke = async (input: Record<string, unknown>, options?: unknown): Promise<string> => {
    try {
      return await originalInvoke(input, options as ToolRunnableConfig | undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ msg: `[tool:${name}] 执行失败`, error: message })
      return JSON.stringify({
        success: false,
        error: `[${name}] ${message}`,
        recoverable: true,
      })
    }
  }

  // StructuredTool 是类实例，直接覆盖 invoke 方法
  const wrapped = Object.create(tool) as StructuredTool
  Object.defineProperty(wrapped, 'invoke', { value: wrappedInvoke, writable: false, configurable: true })
  return wrapped
}

/**
 * 批量包装工具数组。
 */
export function wrapTools(tools: StructuredTool[]): StructuredTool[] {
  return tools.map((t) => wrapTool(t))
}
