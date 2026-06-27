/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures this data is available when vi.mock factory runs
const { mockWidgets } = vi.hoisted(() => {
  const mockWidgets = [
    // container (2)
    { type: 'dialog', group: 'container', canHaveChildren: true, displayName: '弹窗', description: '弹窗容器', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'form', group: 'container', canHaveChildren: true, displayName: '表单', description: '表单容器', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    // layout (8)
    { type: 'card', group: 'layout', canHaveChildren: true, displayName: '卡片', description: '卡片容器', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'divider', group: 'layout', canHaveChildren: false, displayName: '分割线', description: '分割线', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'double-col', group: 'layout', canHaveChildren: true, displayName: '双列布局', description: '双列', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'quad-col', group: 'layout', canHaveChildren: true, displayName: '四列布局', description: '四列', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'single-col', group: 'layout', canHaveChildren: true, displayName: '单列布局', description: '单列', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'spacer', group: 'layout', canHaveChildren: false, displayName: '间距', description: '间距', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'tabs', group: 'layout', canHaveChildren: true, displayName: '标签页', description: '标签页', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'triple-col', group: 'layout', canHaveChildren: true, displayName: '三列布局', description: '三列', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    // form (18)
    { type: 'autocomplete', group: 'form', canHaveChildren: false, displayName: '自动补全', description: '自动补全', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'cascader', group: 'form', canHaveChildren: false, displayName: '级联选择', description: '级联', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'checkbox', group: 'form', canHaveChildren: false, displayName: '复选框', description: '复选', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'color-picker', group: 'form', canHaveChildren: false, displayName: '颜色选择', description: '颜色', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'date', group: 'form', canHaveChildren: false, displayName: '日期', description: '日期', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'date-time-slot', group: 'form', canHaveChildren: false, displayName: '时间插槽', description: '时间插槽', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'input', group: 'form', canHaveChildren: false, displayName: '输入框', description: '输入框', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'number', group: 'form', canHaveChildren: false, displayName: '数字输入', description: '数字', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'radio', group: 'form', canHaveChildren: false, displayName: '单选框', description: '单选', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'rate', group: 'form', canHaveChildren: false, displayName: '评分', description: '评分', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'richtext', group: 'form', canHaveChildren: false, displayName: '富文本', description: '富文本', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'select', group: 'form', canHaveChildren: false, displayName: '选择框', description: '选择', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'slider', group: 'form', canHaveChildren: false, displayName: '滑块', description: '滑块', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'switch', group: 'form', canHaveChildren: false, displayName: '开关', description: '开关', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'tag-input', group: 'form', canHaveChildren: false, displayName: '标签输入', description: '标签', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'textarea', group: 'form', canHaveChildren: false, displayName: '文本域', description: '文本域', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'time-picker', group: 'form', canHaveChildren: false, displayName: '时间选择', description: '时间', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'upload', group: 'form', canHaveChildren: false, displayName: '上传', description: '上传', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    // static (2)
    { type: 'banner', group: 'static', canHaveChildren: false, displayName: '横幅', description: '横幅', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'title', group: 'static', canHaveChildren: false, displayName: '标题', description: '标题', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    // action (2)
    { type: 'button', group: 'action', canHaveChildren: false, displayName: '按钮', description: '按钮', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'toolbar-buttons', group: 'action', canHaveChildren: false, displayName: '工具栏按钮', description: '工具栏', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    // table (3)
    { type: 'editable-table', group: 'table', canHaveChildren: false, displayName: '可编辑表格', description: '可编辑表格', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'search-list', group: 'table', canHaveChildren: false, displayName: '搜索列表', description: '搜索列表', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'table', group: 'table', canHaveChildren: false, displayName: '表格', description: '表格', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    // business (3)
    { type: 'file-list', group: 'business', canHaveChildren: false, displayName: '文件列表', description: '文件列表', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'transfer', group: 'business', canHaveChildren: false, displayName: '穿梭框', description: '穿梭', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'tree-layout', group: 'business', canHaveChildren: false, displayName: '树形布局', description: '树形', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    // chart (9)
    { type: 'bar-chart', group: 'chart', canHaveChildren: false, displayName: '柱状图', description: '柱状图', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'candlestick', group: 'chart', canHaveChildren: false, displayName: 'K线图', description: 'K线', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'funnel', group: 'chart', canHaveChildren: false, displayName: '漏斗图', description: '漏斗', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'gauge', group: 'chart', canHaveChildren: false, displayName: '仪表盘', description: '仪表', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'heatmap', group: 'chart', canHaveChildren: false, displayName: '热力图', description: '热力', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'line-chart', group: 'chart', canHaveChildren: false, displayName: '折线图', description: '折线', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'pie-chart', group: 'chart', canHaveChildren: false, displayName: '饼图', description: '饼图', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'radar', group: 'chart', canHaveChildren: false, displayName: '雷达图', description: '雷达', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
    { type: 'scatter-chart', group: 'chart', canHaveChildren: false, displayName: '散点图', description: '散点', defaultProps: {}, keyProps: [], defaultSize: null, exposedValues: [], receivableEvents: [], eventTargets: [], configPanels: [] },
  ]
  return { mockWidgets }
})

vi.mock('../tools/toolHandlers.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../tools/toolHandlers.js')>()
  return {
    ...orig,
    getMetadata: vi.fn().mockReturnValue({ widgets: mockWidgets, flowNodes: [] }),
    handleWidgetQuery: vi.fn((category?: string) => {
      const filtered = category
        ? mockWidgets.filter((w) => w.group === category)
        : mockWidgets
      return { success: true, data: { total: filtered.length, widgets: filtered }, summary: `${filtered.length} widgets` }
    }),
    handleWidgetValidate: vi.fn(async (widgets: Record<string, unknown>[]) => {
      // Inline validation logic matching schemaService.validateWidgetSchema
      const VALID_TYPES = new Set(mockWidgets.map((w) => w.type))
      const CONTAINER_TYPES = new Set(['dialog', 'form'])
      const errors: Array<{ path: string; message: string }> = []

      function walk(nodes: Record<string, unknown>[], prefix: string, depth: number): void {
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i]
          const path = prefix ? `${prefix}[${i}]` : `[${i}]`
          const type = node.type as string | undefined

          if (!type) {
            errors.push({ path: `${path}.type`, message: '缺少 type 字段' })
            continue
          }
          if (!VALID_TYPES.has(type)) {
            errors.push({ path: `${path}.type`, message: `无效的组件类型 "${type}"` })
            continue
          }

          const id = node.id as string | undefined
          if (!id) {
            errors.push({ path: `${path}.id`, message: '缺少 id 字段' })
          }

          const pos = node.position as Record<string, unknown> | undefined
          if (!pos || typeof pos !== 'object') {
            errors.push({ path: `${path}.position`, message: '缺少 position 字段' })
          } else {
            for (const key of ['x', 'y', 'w', 'h']) {
              if (typeof pos[key] !== 'number' || (pos[key] as number) < 0) {
                errors.push({ path: `${path}.position.${key}`, message: `position.${key} 必须为非负数` })
              }
            }
          }

          const isContainer = CONTAINER_TYPES.has(type)
          const children = node.children as Record<string, unknown>[] | undefined

          if (isContainer) {
            if (!Array.isArray(children)) {
              errors.push({ path: `${path}.children`, message: `容器组件 "${type}" 必须有 children 数组` })
            } else {
              walk(children, path, depth + 1)
            }
          } else if (depth === 0 && !isContainer) {
            errors.push({ path, message: `基础组件 "${type}" 必须嵌套在布局容器内` })
          }
        }
      }

      walk(widgets, '', 0)
      return { success: true, data: { valid: errors.length === 0, errors }, summary: errors.length === 0 ? 'Schema 校验通过' : `${errors.length} 个错误` }
    }),
  }
})

import { queryWidgets, validateSchema, queryWidgetsTool, validateWidgetSchemaTool } from '../tools/widgetTools.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('queryWidgets (utility)', () => {
  it('returns all widgets when no category filter', async () => {
    const result = await queryWidgets()
    expect(result.total).toBeGreaterThan(30)
    expect(result.widgets.length).toBe(result.total)
  })

  it('filters by category', async () => {
    const layout = await queryWidgets('layout')
    expect(layout.widgets.every((w) => w.group === 'layout')).toBe(true)
    expect(layout.total).toBeGreaterThan(0)

    const form = await queryWidgets('form')
    expect(form.widgets.every((w) => w.group === 'form')).toBe(true)
  })

  it('returns empty for unknown category', async () => {
    const result = await queryWidgets('nonexistent')
    expect(result.total).toBe(0)
    expect(result.widgets).toEqual([])
  })

  it('includes expected widget types', async () => {
    const all = await queryWidgets()
    const types = all.widgets.map((w) => w.type)
    expect(types).toContain('input')
    expect(types).toContain('select')
    expect(types).toContain('table')
    expect(types).toContain('form')
    expect(types).toContain('card')
    expect(types).toContain('tabs')
  })
})

describe('validateSchema (utility)', () => {
  const makeWidget = (overrides: Record<string, unknown> = {}) => ({
    id: '550e8400-e29b-41d4-a716-446655440000',
    type: 'input',
    field: 'userName',
    label: '用户名',
    props: { placeholder: '请输入' },
    position: { x: 0, y: 0, w: 12, h: 2 },
    ...overrides,
  })

  const makeContainer = (children: Record<string, unknown>[] = []) => ({
    id: '550e8400-e29b-41d4-a716-446655440001',
    type: 'form',
    field: '',
    label: '',
    props: {},
    position: { x: 0, y: 0, w: 24, h: 10 },
    children,
  })

  it('validates a simple valid schema', async () => {
    const result = await validateSchema([makeContainer([makeWidget()])])
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects widget without type', async () => {
    const result = await validateSchema([{ id: '550e8400-e29b-41d4-a716-446655440000', position: { x: 0, y: 0, w: 1, h: 1 } }])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('type'))).toBe(true)
  })

  it('rejects invalid widget type', async () => {
    const result = await validateSchema([makeContainer([makeWidget({ type: 'nonexistent' })])])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('nonexistent'))).toBe(true)
  })

  it('rejects missing id', async () => {
    const result = await validateSchema([makeContainer([makeWidget({ id: undefined })])])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('id'))).toBe(true)
  })

  it('rejects missing position', async () => {
    const result = await validateSchema([makeContainer([makeWidget({ position: undefined })])])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('position'))).toBe(true)
  })

  it('rejects negative position values', async () => {
    const result = await validateSchema([makeContainer([makeWidget({ position: { x: -1, y: 0, w: 1, h: 1 } })])])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('非负'))).toBe(true)
  })

  it('rejects top-level non-container widget', async () => {
    const result = await validateSchema([makeWidget()])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('嵌套'))).toBe(true)
  })

  it('rejects container without children array', async () => {
    const result = await validateSchema([{ ...makeContainer(), children: undefined }])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('children'))).toBe(true)
  })

  it('validates nested structure recursively', async () => {
    const nested = makeContainer([
      makeContainer([makeWidget()]),
    ])
    const result = await validateSchema([nested])
    expect(result.valid).toBe(true)
  })

  it('reports error for missing type (stops early)', async () => {
    const result = await validateSchema([
      makeWidget({ id: undefined, type: undefined, position: undefined }),
    ])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.message.includes('type'))).toBe(true)
  })

  it('reports multiple errors when type is valid but other fields missing', async () => {
    const result = await validateSchema([
      makeContainer([makeWidget({ id: undefined, position: undefined })]),
    ])
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })
})

describe('queryWidgetsTool (LangGraph tool)', () => {
  it('invokes with no arguments and returns all widgets', async () => {
    const result = await queryWidgetsTool.invoke({})
    const parsed = typeof result === 'string' ? JSON.parse(result) : result
    expect(parsed.data.total).toBeGreaterThan(30)
  })

  it('invokes with category filter', async () => {
    const result = await queryWidgetsTool.invoke({ category: 'form' })
    const parsed = typeof result === 'string' ? JSON.parse(result) : result
    expect(parsed.data.total).toBeGreaterThan(0)
    expect(parsed.data.widgets.every((w: { group: string }) => w.group === 'form')).toBe(true)
  })
})

describe('validateWidgetSchemaTool (LangGraph tool)', () => {
  it('invokes with valid schema', async () => {
    const widget = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'input',
      position: { x: 0, y: 0, w: 12, h: 2 },
    }
    const container = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      type: 'form',
      position: { x: 0, y: 0, w: 24, h: 10 },
      children: [widget],
    }
    const result = await validateWidgetSchemaTool.invoke({ widgets: [container] })
    const parsed = typeof result === 'string' ? JSON.parse(result) : result
    expect(parsed.data.valid).toBe(true)
  })

  it('invokes with invalid schema and returns errors', async () => {
    const result = await validateWidgetSchemaTool.invoke({
      widgets: [{ id: '550e8400-e29b-41d4-a716-446655440000', position: { x: 0, y: 0, w: 1, h: 1 } }],
    })
    const parsed = typeof result === 'string' ? JSON.parse(result) : result
    expect(parsed.data.valid).toBe(false)
    expect(parsed.data.errors.length).toBeGreaterThan(0)
  })
})
