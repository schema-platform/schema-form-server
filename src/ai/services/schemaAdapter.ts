/**
 * Schema 适配层 — 将 AI 生成的简化 Widget 转换为 Editor 完整 Widget。
 *
 * AI LLM 无法一次输出完整的 30+ 字段 Widget 结构。
 * 适配器负责：
 * 1. type → name 映射（input → FgInput）
 * 2. 自动生成 formId（遍历容器树）
 * 3. 补全 position 默认值（自动布局）
 * 4. 补全 validationRules（从 props 推导）
 * 5. 校验并修复常见错误
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

// ────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────

interface WidgetAIMetadata {
  type: string
  group: string
  canHaveChildren: boolean
  displayName: string
  defaultProps: Record<string, unknown>
  keyProps: string[]
  defaultSize: { w: number; h: number } | null
}

interface AIMetadata {
  version: string
  widgets: WidgetAIMetadata[]
}

export interface PartialWidget {
  type: string
  field?: string
  label?: string
  props?: Record<string, unknown>
  position?: { x: number; y: number; w: number; h: number }
  children?: PartialWidget[]
  options?: Array<{ label: string; value: string | number | boolean }>
  validationRules?: Array<Record<string, unknown>>
  linkages?: Array<Record<string, unknown>>
  events?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export interface AdaptedWidget {
  id: string
  name: string
  type: string
  field?: string
  label?: string
  props: Record<string, unknown>
  position: { x: number; y: number; w: number; h: number }
  options?: Array<{ label: string; value: string | number | boolean }>
  validationRules?: Array<Record<string, unknown>>
  linkages?: Array<Record<string, unknown>>
  events?: Array<Record<string, unknown>>
  formId?: string
  tabKey?: string
  colIndex?: number
  children?: AdaptedWidget[]
  [key: string]: unknown
}

// ────────────────────────────────────────────
// 元数据加载
// ────────────────────────────────────────────

let metadata: AIMetadata | null = null
let typeMap: Map<string, WidgetAIMetadata> | null = null
let nameMap: Map<string, string> | null = null

// type → Vue component name 映射规则
const TYPE_NAME_RULES: Record<string, string> = {
  // container
  form: 'FgForm',
  dialog: 'FgDialog',
  // layout
  card: 'FgCard',
  tabs: 'FgTabs',
  'single-col': 'FgSingleCol',
  'double-col': 'FgDoubleCol',
  'triple-col': 'FgTripleCol',
  'quad-col': 'FgQuadCol',
  divider: 'FgDivider',
  spacer: 'FgSpacer',
  // form
  input: 'FgInput',
  number: 'FgNumber',
  select: 'FgSelect',
  radio: 'FgRadio',
  checkbox: 'FgCheckbox',
  date: 'FgDate',
  'date-time-slot': 'FgDateTimeSlot',
  'time-picker': 'FgTimePicker',
  textarea: 'FgTextarea',
  richtext: 'FgRichtext',
  upload: 'FgUpload',
  switch: 'FgSwitch',
  slider: 'FgSlider',
  rate: 'FgRate',
  cascader: 'FgCascader',
  'color-picker': 'FgColorPicker',
  'tag-input': 'FgTagInput',
  autocomplete: 'FgAutocomplete',
  descriptions: 'FgDescriptions',
  statistic: 'FgStatistic',
  // static
  title: 'FgTitle',
  banner: 'FgBanner',
  // action
  button: 'FgButton',
  'toolbar-buttons': 'FgToolbarButtons',
  // table
  table: 'FgTable',
  'search-list': 'FgSearchList',
  'editable-table': 'FgEditableTable',
  // business
  'file-list': 'FgFileList',
  transfer: 'FgTransfer',
  'tree-layout': 'FgTreeLayout',
  // chart
  'bar-chart': 'FgBarChart',
  candlestick: 'FgCandlestick',
  funnel: 'FgFunnel',
  gauge: 'FgGauge',
  heatmap: 'FgHeatmap',
  'line-chart': 'FgLineChart',
  'pie-chart': 'FgPieChart',
  radar: 'FgRadar',
  'scatter-chart': 'FgScatterChart',
}

function loadMetadata(): AIMetadata {
  if (!metadata) {
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('@schema-form/ai-shared/package.json')
    const jsonPath = join(dirname(pkgPath), 'metadata.json')
    metadata = JSON.parse(readFileSync(jsonPath, 'utf-8')) as AIMetadata
  }
  return metadata
}

function getTypeMap(): Map<string, WidgetAIMetadata> {
  if (!typeMap) {
    const meta = loadMetadata()
    typeMap = new Map(meta.widgets.map((w) => [w.type, w]))
  }
  return typeMap
}

function getNameMap(): Map<string, string> {
  if (!nameMap) {
    nameMap = new Map(Object.entries(TYPE_NAME_RULES))
  }
  return nameMap
}

// ────────────────────────────────────────────
// 适配器
// ────────────────────────────────────────────

/**
 * 将 AI 输出的 PartialWidget[] 转换为完整的 AdaptedWidget[]。
 */
export function adaptWidgets(partialWidgets: PartialWidget[]): AdaptedWidget[] {
  const tMap = getTypeMap()
  const nMap = getNameMap()

  // 第一遍：基础适配
  const widgets = partialWidgets.map((w) => adaptWidget(w, tMap, nMap, null, 0))

  // 第二遍：补全容器绑定（formId, tabKey, colIndex）
  resolveContainerBindings(widgets, null)

  // 第三遍：自动布局（补全缺失的 position）
  autoLayout(widgets, tMap)

  // 第四遍：校验 + 修复
  validateAndFix(widgets, tMap)

  return widgets
}

/**
 * 单个 Widget 适配。
 */
function adaptWidget(
  partial: PartialWidget,
  tMap: Map<string, WidgetAIMetadata>,
  nMap: Map<string, string>,
  parentId: string | null,
  depth: number,
): AdaptedWidget {
  const meta = tMap.get(partial.type)
  const id = partial.type + '_' + generateId()

  const widget: AdaptedWidget = {
    id,
    name: nMap.get(partial.type) ?? 'FgInput',
    type: partial.type,
    field: partial.field,
    label: partial.label,
    props: adaptProps(partial, meta),
    position: partial.position ?? { x: 0, y: 0, w: 0, h: 0 },
    options: partial.options,
    validationRules: adaptValidationRules(partial),
    linkages: partial.linkages as AdaptedWidget['linkages'],
    events: partial.events as AdaptedWidget['events'],
    children: partial.children?.map((c) => adaptWidget(c, tMap, nMap, id, depth + 1)),
  }

  return widget
}

/**
 * 属性适配：从 defaultProps 补全缺失的属性。
 */
function adaptProps(partial: PartialWidget, meta?: WidgetAIMetadata): Record<string, unknown> {
  const props: Record<string, unknown> = { ...partial.props }

  if (meta?.defaultProps) {
    for (const [key, defaultValue] of Object.entries(meta.defaultProps)) {
      if (props[key] === undefined) {
        props[key] = defaultValue
      }
    }
  }

  // 特殊组件：options 放到 props 中
  if (['select', 'radio', 'checkbox', 'cascader'].includes(partial.type)) {
    if (partial.options && !props.options) {
      props.options = partial.options
    }
  }

  return props
}

/**
 * 校验规则适配：从 props 推导 validationRules。
 */
function adaptValidationRules(partial: PartialWidget): Array<Record<string, unknown>> | undefined {
  const rules: Array<Record<string, unknown>> = [...(partial.validationRules ?? [])]

  // 从 props.required 推导必填规则
  if (partial.props?.required && !rules.some((r) => r.required)) {
    rules.push({
      required: true,
      message: `请填写${partial.label ?? partial.field ?? ''}`,
      trigger: 'blur',
    })
  }

  // 从 props.maxlength 推导长度限制
  if (partial.props?.maxlength && !rules.some((r) => r.max)) {
    rules.push({
      max: Number(partial.props.maxlength),
      message: `长度不能超过 ${partial.props.maxlength} 个字符`,
      trigger: 'blur',
    })
  }

  return rules.length > 0 ? rules : undefined
}

/**
 * 容器绑定解析：为容器内的组件生成 formId、tabKey、colIndex。
 */
function resolveContainerBindings(widgets: AdaptedWidget[], parentFormId: string | null): void {
  for (const widget of widgets) {
    if (widget.type === 'form') {
      const formId = widget.id
      widget.formId = formId
      if (widget.children) {
        resolveContainerBindings(widget.children, formId)
      }
    } else if (widget.type === 'tabs') {
      if (widget.children) {
        for (let i = 0; i < widget.children.length; i++) {
          const tab = widget.children[i]
          tab.tabKey = tab.id ?? `tab_${i}`
          if (tab.children) {
            resolveContainerBindings(tab.children, parentFormId)
          }
        }
      }
    } else if (['single-col', 'double-col', 'triple-col', 'quad-col'].includes(widget.type)) {
      if (widget.children) {
        for (let i = 0; i < widget.children.length; i++) {
          const child = widget.children[i]
          child.colIndex = i
          child.formId = parentFormId ?? undefined
          if (child.children) {
            resolveContainerBindings(child.children, parentFormId)
          }
        }
      }
    } else if (widget.children) {
      widget.formId = parentFormId ?? undefined
      resolveContainerBindings(widget.children, parentFormId)
    } else {
      widget.formId = parentFormId ?? undefined
    }
  }
}

/**
 * 自动布局：为缺失 position 的组件生成合理的位置。
 */
function autoLayout(widgets: AdaptedWidget[], tMap: Map<string, WidgetAIMetadata>): void {
  let currentY = 0
  const DEFAULT_W = 24
  const DEFAULT_H = 2

  for (const widget of widgets) {
    if (!widget.position || (widget.position.w === 0 && widget.position.h === 0)) {
      const meta = tMap.get(widget.type)
      const defaultSize = meta?.defaultSize

      widget.position = {
        x: 0,
        y: currentY,
        w: defaultSize?.w ?? DEFAULT_W,
        h: defaultSize?.h ?? DEFAULT_H,
      }
    }

    currentY += widget.position.h

    if (widget.children) {
      autoLayout(widget.children, tMap)
    }
  }
}

/**
 * 校验并修复常见错误。
 */
function validateAndFix(widgets: AdaptedWidget[], tMap: Map<string, WidgetAIMetadata>): void {
  for (const widget of widgets) {
    const meta = tMap.get(widget.type)

    // 容器必须有 children
    if (meta?.canHaveChildren && !widget.children?.length) {
      widget.children = []
    }

    // position 不能为负数
    if (widget.position) {
      widget.position.x = Math.max(0, widget.position.x)
      widget.position.y = Math.max(0, widget.position.y)
      widget.position.w = Math.max(1, widget.position.w)
      widget.position.h = Math.max(1, widget.position.h)
    }

    if (widget.children) {
      validateAndFix(widget.children, tMap)
    }
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 7)
}
