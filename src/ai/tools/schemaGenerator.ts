/**
 * Schema Generator — 被其他 Agent 调用的 Schema 生成能力
 *
 * 封装 Editor Agent 的核心生成逻辑，供 Flow Agent 的 generate_schema tool 使用。
 * 不走 SSE 流式，直接返回最终结果。
 */

import { v4 as uuidv4 } from 'uuid'
import { getClient, buildMessages, parseStructuredOutput, withRetry } from '../graph/agentBase.js'
import { buildEditorSystemPrompt } from '@schema-form/ai-shared/promptBuilder'
import { getMetadata } from './toolHandlers.js'

interface GenerateResult {
  tempId: string
  widgets: Record<string, unknown>[]
  summary: string
}

// 缓存 prompt
let editorPrompt: string | null = null

async function getPrompt(): Promise<string> {
  if (!editorPrompt) {
    editorPrompt = buildEditorSystemPrompt(getMetadata())
  }
  return editorPrompt
}

/**
 * 从自然语言描述生成 Widget Schema。
 *
 * @param description 表单的自然语言描述
 * @returns 生成的 Schema widgets 和临时 ID
 */
export async function generateSchemaFromPrompt(description: string): Promise<GenerateResult> {
  const openai = getClient()
  const systemPrompt = await getPrompt()

  const messages = buildMessages(
    {
      messages: [{ role: 'user' as const, content: description }],
      activeAgent: 'editor',
      context: { source: 'flow', turnCount: 1 },
    },
    systemPrompt,
    (state) => state.messages[state.messages.length - 1].content,
  )

  // 调用 LLM 生成（非流式，单轮）
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

  // 从 <schema> 标签中提取 widgets
  const widgets = parseSchemaFromOutput(parsed.schemaRaw)

  if (widgets.length === 0) {
    throw new Error('LLM 未生成有效的 Schema JSON')
  }

  // 校验
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
  walk(widgets, 0)

  if (errors.length > 0) {
    throw new Error(`生成的 Schema 校验失败: ${errors.join('; ')}`)
  }

  const tempId = `temp_${uuidv4().slice(0, 8)}`
  const summary = parsed.answer || `已生成包含 ${widgets.length} 个组件的表单 Schema`

  return { tempId, widgets, summary }
}

function parseSchemaFromOutput(schemaRaw: string): Record<string, unknown>[] {
  if (!schemaRaw) return []

  const jsonMatch = schemaRaw.match(/```(?:json)?\s*([\s\S]*?)```/) || schemaRaw.match(/(\{[\s\S]*\})/)
  if (!jsonMatch) return []

  try {
    const parsed = JSON.parse(jsonMatch[1].trim()) as Record<string, unknown>
    if (parsed.type === 'schema_update' && Array.isArray(parsed.widgets)) {
      return parsed.widgets as Record<string, unknown>[]
    }
  } catch {
    // JSON parse failed
  }
  return []
}
