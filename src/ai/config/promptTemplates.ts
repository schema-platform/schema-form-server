/**
 * Built-in Prompt Templates.
 *
 * Pre-configured templates for common AI tasks.
 * These are seeded into the database on first startup.
 */

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface PromptTemplateConfig {
  name: string
  description: string
  category: 'schema' | 'flow' | 'general' | 'custom'
  template: string
  variables: string[]
  tags: string[]
}

// ────────────────────────────────────────────
// Built-in templates
// ────────────────────────────────────────────

export const builtinPromptTemplates: PromptTemplateConfig[] = [
  {
    name: 'Schema 生成',
    description: '根据用户描述生成完整的表单 Schema',
    category: 'schema',
    template: `你是一个表单 Schema 生成专家。请根据用户的描述，生成一个完整的表单 Schema。

要求：
1. 使用 JSON 格式输出
2. 包含完整的组件配置（id、type、props、position）
3. 支持验证规则
4. 支持布局配置
5. 组件类型必须是系统支持的 49 种类型之一

用户描述：{{description}}

{{#currentSchema}}
当前已有 Schema，请在此基础上增量编辑：
\`\`\`json
{{currentSchema}}
\`\`\`
{{/currentSchema}}

请生成 Schema：`,
    variables: ['description', 'currentSchema'],
    tags: ['schema', 'generation', 'form'],
  },
  {
    name: 'Schema 修改',
    description: '根据指令修改现有表单 Schema',
    category: 'schema',
    template: `你是一个表单 Schema 编辑专家。请根据用户的指令，对当前 Schema 进行增量修改。

当前 Schema：
\`\`\`json
{{currentSchema}}
\`\`\`

修改指令：{{instructions}}

修改规则：
1. 只修改用户要求变更的组件，其余原样保留
2. 未变更组件的 id 和 position 不可改变
3. 新增组件生成新的 id
4. 删除组件时确保不影响其他组件的布局

请返回修改后的完整 Schema：`,
    variables: ['currentSchema', 'instructions'],
    tags: ['schema', 'modification', 'form'],
  },
  {
    name: '流程生成',
    description: '根据用户描述生成审批流程',
    category: 'flow',
    template: `你是一个流程设计专家。请根据用户的描述，生成一个完整的审批流程。

要求：
1. 使用标准流程节点格式
2. 包含开始和结束节点
3. 包含审批节点（userTask）
4. 包含网关节点（exclusiveGateway）用于条件分支
5. 节点之间用边（edge）连接

用户描述：{{description}}

请生成流程：`,
    variables: ['description'],
    tags: ['flow', 'generation', 'bpmn'],
  },
  {
    name: '代码解释',
    description: '解释 Schema 结构和组件用法',
    category: 'general',
    template: `请解释以下 Schema 的结构和功能：

\`\`\`json
{{schema}}
\`\`\`

请从以下角度解释：
1. 整体布局结构
2. 各组件的功能和配置
3. 事件和联动关系
4. 数据流向`,
    variables: ['schema'],
    tags: ['general', 'explanation', 'documentation'],
  },
  {
    name: 'Schema 优化建议',
    description: '分析 Schema 并提供优化建议',
    category: 'general',
    template: `请分析以下 Schema 并提供优化建议：

\`\`\`json
{{schema}}
\`\`\`

请从以下角度分析：
1. 用户体验（布局合理性、交互流畅性）
2. 性能（组件数量、嵌套深度）
3. 可维护性（命名规范、结构清晰度）
4. 可访问性（标签完整性、键盘导航）

请给出具体的优化建议和修改方案。`,
    variables: ['schema'],
    tags: ['general', 'optimization', 'analysis'],
  },
]

// ────────────────────────────────────────────
// Template rendering
// ────────────────────────────────────────────

/**
 * Render a template string by replacing {{variable}} placeholders.
 *
 * Supports:
 * - Simple variables: {{varName}}
 * - Conditional blocks: {{#varName}}...{{/varName}}
 *
 * @param template - Template string with placeholders
 * @param variables - Key-value pairs to substitute
 * @returns Rendered string
 */
export function renderTemplate(template: string, variables: Record<string, unknown>): string {
  let result = template

  // Process conditional blocks {{#var}}...{{/var}}
  result = result.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_match, key: string, block: string) => {
      const value = variables[key]
      if (value != null && value !== '' && value !== false) {
        // Render block, replacing inner variables
        return block.replace(/\{\{(\w+)\}\}/g, (_m: string, innerKey: string) => {
          const innerVal = variables[innerKey]
          if (innerVal == null) return ''
          return typeof innerVal === 'string' ? innerVal : JSON.stringify(innerVal)
        })
      }
      return ''
    },
  )

  // Process simple variables {{varName}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key]
    if (value == null) return ''
    return typeof value === 'string' ? value : JSON.stringify(value)
  })

  return result
}

/**
 * Extract variable names from a template string.
 *
 * @param template - Template string
 * @returns Array of unique variable names
 */
export function extractVariables(template: string): string[] {
  const variables = new Set<string>()

  // Match conditional blocks
  const conditionalRegex = /\{\{#(\w+)\}\}/g
  let match = conditionalRegex.exec(template)
  while (match) {
    variables.add(match[1])
    match = conditionalRegex.exec(template)
  }

  // Match simple variables (excluding block openers/closers)
  const variableRegex = /\{\{(?![#/])(\w+)\}\}/g
  match = variableRegex.exec(template)
  while (match) {
    variables.add(match[1])
    match = variableRegex.exec(template)
  }

  return Array.from(variables)
}
