/**
 * Stream Schema Generator — 流式分步生成 Schema
 *
 * 将 Schema 生成过程分解为多个步骤，每步生成后通过 SSE 实时推送更新。
 * 步骤：layout → components → validation → styling
 */

import { v4 as uuidv4 } from 'uuid'
import { getClient, buildMessages, parseStructuredOutput, withRetry } from '../graph/agentBase.js'
import { buildEditorSystemPrompt } from '@schema-form/ai-shared/promptBuilder'
import { getMetadata } from './toolHandlers.js'

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export type SchemaStep = 'layout' | 'components' | 'validation' | 'styling'

export interface SchemaChunk {
  type: 'schema_update' | 'schema_complete'
  step?: SchemaStep
  schema: Record<string, unknown>[]
  summary?: string
}

interface StepConfig {
  type: SchemaStep
  description: string
  prompt: string
}

// ────────────────────────────────────────────
// Step definitions
// ────────────────────────────────────────────

const SCHEMA_STEPS: StepConfig[] = [
  {
    type: 'layout',
    description: '生成布局结构',
    prompt: `基于用户需求，生成页面的布局容器结构。
要求：
1. 选择合适的布局容器（如 flex, grid, card, tabs 等）
2. 确定页面的整体结构和分区
3. 为每个容器设置合理的尺寸和位置
4. 使用有意义的 id 命名（如 layout_header, layout_content, layout_sidebar）

输出格式：
\`\`\`json
{
  "type": "schema_update",
  "step": "layout",
  "widgets": [...]
}
\`\`\``,
  },
  {
    type: 'components',
    description: '添加表单组件',
    prompt: `在已有布局基础上，添加具体的表单组件。
要求：
1. 根据需求选择合适的表单组件（input, select, date-picker, upload 等）
2. 为每个组件设置 field（字段名）、label（标签）、placeholder 等
3. 组件必须放置在合适的容器内
4. 使用有意义的 id 命名（如 form_name, form_email, form_phone）

输出格式：
\`\`\`json
{
  "type": "schema_update",
  "step": "components",
  "widgets": [...]
}
\`\`\``,
  },
  {
    type: 'validation',
    description: '添加验证规则',
    prompt: `为表单组件添加验证规则。
要求：
1. 根据字段类型添加合适的验证规则（必填、长度限制、格式校验等）
2. 设置友好的错误提示信息
3. 对于特殊字段（邮箱、手机号、身份证等）添加格式验证
4. 设置合理的验证时机（blur、change）

输出格式：
\`\`\`json
{
  "type": "schema_update",
  "step": "validation",
  "widgets": [...]
}
\`\`\``,
  },
  {
    type: 'styling',
    description: '添加样式配置',
    prompt: `为组件添加样式配置，优化视觉效果。
要求：
1. 设置合理的间距（margin、padding）
2. 配置字体大小、颜色
3. 添加响应式布局配置
4. 设置操作按钮的样式和位置

输出格式：
\`\`\`json
{
  "type": "schema_update",
  "step": "styling",
  "widgets": [...]
}
\`\`\``,
  },
]

// ────────────────────────────────────────────
// Prompt cache
// ────────────────────────────────────────────

let editorPrompt: string | null = null

async function getPrompt(): Promise<string> {
  if (!editorPrompt) {
    editorPrompt = buildEditorSystemPrompt(getMetadata())
  }
  return editorPrompt
}

// ────────────────────────────────────────────
// Main generator function
// ────────────────────────────────────────────

/**
 * 流式生成 Schema，通过 AsyncIterable 逐步返回更新。
 *
 * @param description 用户的自然语言描述
 * @param currentSchema 可选的当前 Schema（用于修改场景）
 * @returns AsyncIterable<SchemaChunk> 逐步返回 Schema 更新
 */
export async function* generateSchemaStream(
  description: string,
  currentSchema?: Record<string, unknown>[],
): AsyncIterable<SchemaChunk> {
  const openai = getClient()
  const systemPrompt = await getPrompt()

  let accumulatedSchema: Record<string, unknown>[] = currentSchema ?? []

  for (const step of SCHEMA_STEPS) {
    // 构建当前步骤的用户消息
    const stepContext = accumulatedSchema.length > 0
      ? `\n\n当前已有的 Schema 结构：\n\`\`\`json\n${JSON.stringify(accumulatedSchema, null, 2)}\n\`\`\``
      : ''

    const userMessage = `用户需求：${description}${stepContext}\n\n当前任务：${step.description}\n\n${step.prompt}`

    // 调用 LLM 生成当前步骤
    const messages = buildMessages(
      {
        messages: [{ role: 'user' as const, content: userMessage }],
        activeAgent: 'editor',
        context: { source: 'standalone', turnCount: 1 },
      },
      systemPrompt,
      (state) => state.messages[state.messages.length - 1].content,
    )

    const completion = await withRetry(() =>
      openai.chat.completions.create({
        model: 'deepseek-v4-pro',
        messages,
        temperature: 0.7,
        max_tokens: 8192,
      }),
    )

    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = parseStructuredOutput(raw)

    // 解析生成的 widgets
    const stepWidgets = parseSchemaFromStepOutput(parsed.schemaRaw ?? raw)

    if (stepWidgets.length > 0) {
      // 合并到累积 Schema
      accumulatedSchema = mergeSchemaStep(accumulatedSchema, stepWidgets, step.type)

      // 发送更新事件
      yield {
        type: 'schema_update',
        step: step.type,
        schema: accumulatedSchema,
        summary: `步骤 [${step.description}] 完成，已添加相关配置`,
      }
    }
  }

  // 验证最终 Schema
  const meta = getMetadata().widgets
  const validTypes = new Set(meta.map(w => w.type))
  const containerTypes = new Set(meta.filter(w => w.canHaveChildren).map(w => w.type))

  const errors: string[] = []
  function walk(nodes: Record<string, unknown>[], depth: number): void {
    for (const node of nodes) {
      const type = node.type as string | undefined
      if (!type || !validTypes.has(type)) {
        errors.push(`无效类型 "${type}"`)
        continue
      }
      if (containerTypes.has(type) && Array.isArray(node.children)) {
        walk(node.children as Record<string, unknown>[], depth + 1)
      }
    }
  }
  walk(accumulatedSchema, 0)

  if (errors.length > 0) {
    throw new Error(`生成的 Schema 校验失败: ${errors.join('; ')}`)
  }

  // 发送完成事件
  yield {
    type: 'schema_complete',
    schema: accumulatedSchema,
    summary: `Schema 生成完成，共 ${countWidgets(accumulatedSchema)} 个组件`,
  }
}

// ────────────────────────────────────────────
// Helper functions
// ────────────────────────────────────────────

function parseSchemaFromStepOutput(schemaRaw: string): Record<string, unknown>[] {
  if (!schemaRaw) return []

  // 尝试从 JSON 代码块中提取
  const jsonMatch = schemaRaw.match(/```(?:json)?\s*([\s\S]*?)```/) || schemaRaw.match(/(\{[\s\S]*\})/)
  if (!jsonMatch) return []

  try {
    const parsed = JSON.parse(jsonMatch[1].trim()) as Record<string, unknown>

    // 支持多种输出格式
    if (Array.isArray(parsed.widgets)) {
      return parsed.widgets as Record<string, unknown>[]
    }
    if (Array.isArray(parsed)) {
      return parsed as Record<string, unknown>[]
    }
    if (parsed.type && typeof parsed.type === 'string') {
      return [parsed]
    }
  } catch {
    // JSON parse failed
  }

  return []
}

function mergeSchemaStep(
  current: Record<string, unknown>[],
  stepWidgets: Record<string, unknown>[],
  stepType: SchemaStep,
): Record<string, unknown>[] {
  if (stepType === 'layout') {
    // 布局步骤：直接替换
    return stepWidgets
  }

  if (stepType === 'components') {
    // 组件步骤：将新组件插入到合适的容器中
    return mergeComponents(current, stepWidgets)
  }

  if (stepType === 'validation') {
    // 验证步骤：为现有组件添加 rules
    return mergeValidation(current, stepWidgets)
  }

  if (stepType === 'styling') {
    // 样式步骤：更新现有组件的样式配置
    return mergeStyling(current, stepWidgets)
  }

  return current
}

function mergeComponents(
  layout: Record<string, unknown>[],
  components: Record<string, unknown>[],
): Record<string, unknown>[] {
  // 找到第一个叶子容器（没有 children 或 children 为空的容器）
  function findLeafContainer(nodes: Record<string, unknown>[]): Record<string, unknown>[] | null {
    for (const node of nodes) {
      if (Array.isArray(node.children)) {
        if (node.children.length === 0) {
          return node.children as Record<string, unknown>[]
        }
        const found = findLeafContainer(node.children as Record<string, unknown>[])
        if (found) return found
      }
    }
    return null
  }

  const target = findLeafContainer(layout)
  if (target) {
    target.push(...components)
    return layout
  }

  // 如果没有找到合适的容器，直接追加到根级别
  return [...layout, ...components]
}

function mergeValidation(
  current: Record<string, unknown>[],
  validationWidgets: Record<string, unknown>[],
): Record<string, unknown>[] {
  // 创建验证规则映射
  const validationMap = new Map<string, Record<string, unknown>[]>()
  for (const widget of validationWidgets) {
    const field = widget.field as string
    if (field && Array.isArray(widget.rules)) {
      validationMap.set(field, widget.rules as Record<string, unknown>[])
    }
  }

  // 递归更新现有组件的 rules
  function updateNodes(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
    return nodes.map((node) => {
      const field = node.field as string
      const rules = validationMap.get(field)

      const updated = rules ? { ...node, rules } : node

      if (Array.isArray(updated.children)) {
        return { ...updated, children: updateNodes(updated.children as Record<string, unknown>[]) }
      }

      return updated
    })
  }

  return updateNodes(current)
}

function mergeStyling(
  current: Record<string, unknown>[],
  stylingWidgets: Record<string, unknown>[],
): Record<string, unknown>[] {
  // 创建样式配置映射
  const styleMap = new Map<string, Record<string, unknown>>()
  for (const widget of stylingWidgets) {
    const id = widget.id as string
    if (id && widget.props) {
      styleMap.set(id, widget.props as Record<string, unknown>)
    }
  }

  // 递归更新现有组件的 props
  function updateNodes(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
    return nodes.map((node) => {
      const id = node.id as string
      const styleProps = styleMap.get(id)

      const updated = styleProps
        ? { ...node, props: { ...(node.props as Record<string, unknown>), ...styleProps } }
        : node

      if (Array.isArray(updated.children)) {
        return { ...updated, children: updateNodes(updated.children as Record<string, unknown>[]) }
      }

      return updated
    })
  }

  return updateNodes(current)
}

function countWidgets(schema: Record<string, unknown>[]): number {
  let count = 0
  function walk(nodes: Record<string, unknown>[]): void {
    for (const node of nodes) {
      count++
      if (Array.isArray(node.children)) {
        walk(node.children as Record<string, unknown>[])
      }
    }
  }
  walk(schema)
  return count
}
