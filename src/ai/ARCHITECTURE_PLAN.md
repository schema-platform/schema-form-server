# AI 架构规划：对话驱动表单/工作流/应用建设

> 目标：用户通过自然语言对话，AI 自动生成符合 editor/flow 大结构的 Schema，可直接应用于编辑器渲染和流程引擎执行。

---

## 一、核心问题分析

### 1.1 当前架构的根本矛盾

```
┌─────────────────────────────────────────────────────────────────┐
│  Editor/Flow 的 Schema 是"重型结构"                             │
│  ├── Widget: 30+ 字段，嵌套 children，容器绑定 formId/tabKey    │
│  ├── FlowNode: BpmnNodeConfig 20+ 字段，28 种节点类型           │
│  └── 校验规则、联动规则、事件系统、变量系统、生命周期             │
├─────────────────────────────────────────────────────────────────┤
│  AI 当前生成的是"简化结构"                                       │
│  ├── Widget 缺少 name/linkages/api/lifecycle/validationRules    │
│  ├── FlowNode 缺少完整 BpmnNodeConfig（审批模式、表单绑定等）    │
│  └── 前端 ai-app 用简化类型渲染预览，但无法直接应用到编辑器      │
├─────────────────────────────────────────────────────────────────┤
│  结果：AI 生成 → 预览看起来对 → 应用到编辑器时缺字段 → 不可用    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 AI 输出与 Editor 期望的差异清单

| 字段 | Editor 要求 | AI 当前输出 | 差异影响 |
|------|------------|------------|---------|
| `name` | 必填（`'FgInput'`） | 缺失 | 渲染器无法映射组件 |
| `position` | 必填 `{x,y,w,h}` | 可选 | 布局错乱 |
| `formId` | 容器内组件必填 | 偶尔遗漏 | 表单数据绑定失败 |
| `linkages` | 结构化 `SchemaLinkage[]` | LLM 自由发挥 | 联动不生效 |
| `validationRules` | `FormItemRule[]` | 缺失或格式不对 | 校验不生效 |
| `api` | `SchemaApiConfig` | 缺失 | 数据源不生效 |
| `events` | `WidgetEvent[]` + 17 种 action | 简化 | 事件不生效 |
| `lifecycle` | 8 个生命周期钩子 | 缺失 | 生命周期不生效 |
| `variables` | `WidgetVariable[]` | 缺失 | 变量系统不生效 |

### 1.3 AI 输出与 Flow 期望的差异清单

| 字段 | Flow 要求 | AI 当前输出 | 差异影响 |
|------|----------|------------|---------|
| `shape` | `'bpmn-node'` / `'bpmn-edge'` | 偶尔遗漏 | X6 渲染失败 |
| `data.approvalMode` | `single/countersign/or-sign` | 简化为单人 | 审批模式错误 |
| `data.formSchemaId` | 关联已有 Schema | 无法关联 | 表单绑定缺失 |
| `data.candidateUsers/Roles` | 指派人配置 | 粗略生成 | 审批人错误 |
| `data.rejectPolicy` | 拒签策略 | 缺失 | 流程行为不符预期 |
| `edge.data.conditionExpression` | 网关条件表达式 | 简化 | 分支逻辑错误 |

---

## 二、项目拆分策略

### 2.1 三项目架构

```
schema-form-platform/
├── packages/
│   ├── editor/web/          # @schema-form/editor-web — 可视化设计器
│   ├── flow/                # @schema-form/flow — 流程设计器 + 引擎
│   ├── shell/ — 主宿主
│   ├── ai/                  # @schema-form/ai — AI 能力层（新建）
│   │   ├── server/          # AI Agent 服务（从 server/ai/ 独立）
│   │   ├── mcp/             # MCP Server 定义（内部专有）
│   │   ├── shared/          # 共享类型 + Schema 适配层
│   │   └── app/             # AI 对话前端（从 ai-app/ 迁入）
│   ├── server/              # @schema-form/server — 纯后端 API
│   └── shared/              # @schema-form/shared — 共享类型
```

### 2.2 为什么不拆成独立仓库

| 维度 | 单仓库（推荐） | 多仓库 |
|------|--------------|--------|
| Schema 类型同步 | pnpm workspace 直接引用 | 需发 npm 包 |
| 开发体验 | 一个 PR 改全链路 | 多仓库协调 |
| 部署 | 一个 CI 流水线 | 多套部署 |
| AI 对 editor/flow 类型的依赖 | `import { Widget } from '@schema-form/editor-web'` | 需要发布 @types 包 |

**结论**：保持 monorepo，但将 AI 从 `server/ai/` 和 `ai-app/` 独立为 `packages/ai/`。

### 2.3 `packages/ai/` 内部结构

```
packages/ai/
├── server/                  # AI Agent 后端服务
│   ├── graph/               # LangGraph 图编排
│   │   ├── graph.ts         # StateGraph 组装
│   │   ├── state.ts         # 状态定义
│   │   ├── editorAgent.ts   # Editor Agent
│   │   ├── flowAgent.ts     # Flow Agent
│   │   ├── pageAgent.ts     # Page Agent
│   │   └── checkpointer.ts  # MongoDB Checkpointer
│   ├── tools/               # LangGraph 专有工具（HITL + 写入 + 协作）
│   │   ├── updateSchema.ts  # HITL Schema 更新
│   │   ├── updateFlow.ts    # HITL Flow 更新
│   │   ├── generateSchema.ts
│   │   ├── saveAndBind.ts
│   │   └── collaboration.ts
│   ├── services/            # 业务逻辑层（MCP 和 Tools 共享）
│   │   ├── schemaService.ts
│   │   ├── flowService.ts
│   │   ├── widgetService.ts
│   │   └── llmCache.ts
│   └── routes.ts            # AI API 路由
│
├── mcp/                     # MCP Server 定义（权威工具源）
│   ├── servers/
│   │   ├── schemaServer.ts  # Schema 工具集
│   │   ├── flowServer.ts    # Flow 工具集
│   │   ├── widgetServer.ts  # Widget 工具集
│   │   ├── ragServer.ts     # RAG 工具集（新增）
│   │   └── industryServer.ts# 行业工具集（新增）
│   ├── bridge.ts            # MCP → LangGraph 桥接层
│   └── transport.ts         # SSE + InMemory 传输层
│
├── shared/                  # AI 共享层
│   ├── types/               # AI 专用类型
│   │   ├── agent.ts         # Agent 类型定义
│   │   ├── sse.ts           # SSE 事件类型
│   │   └── tool.ts          # 工具结果类型
│   ├── schemaAdapter.ts     # Schema 适配层（核心！）
│   ├── flowAdapter.ts       # Flow 适配层（核心！）
│   └── promptBuilder.ts     # Prompt 构建器
│
└── app/                     # AI 对话前端
    ├── components/          # 对话组件
    ├── stores/              # AI 状态管理
    └── views/               # 页面视图
```

---

## 三、Schema 适配层设计（核心）

### 3.1 问题本质

AI LLM 无法一次输出完整的 30+ 字段 Widget 结构，原因：
1. **Token 限制**：完整 Widget JSON 约 200-500 tokens/个，10 个组件就 2000-5000 tokens
2. **复杂度**：linkages/events/api/lifecycle 需要精确的结构化配置
3. **上下文依赖**：formId 依赖容器关系，tabKey 依赖标签页配置

### 3.2 解决方案：分层生成 + 适配器补全

```
用户输入："创建一个请假申请表单"
           ↓
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: LLM 生成"骨架"                                      │
│  输出：{ type, field, label, props, position, children }      │
│  约 30% 的字段，但覆盖核心业务语义                              │
└──────────────────────┬───────────────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────────────┐
│  Layer 2: SchemaAdapter 自动补全                               │
│  ├── type → name 映射（input → FgInput）                      │
│  ├── 自动生成 formId（遍历容器树）                              │
│  ├── 补全 position 默认值（自动布局）                           │
│  ├── 补全 validationRules（从 props.required 推导）            │
│  ├── 补全 linkages（从条件表达式推导）                          │
│  └── 补全生命周期钩子（从事件推导）                             │
└──────────────────────┬───────────────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────────────┐
│  Layer 3: 校验 + 修复                                         │
│  ├── validateWidgetSchema() 完整校验                           │
│  ├── 自动修复常见错误（缺少 children、position 越界）           │
│  └── 输出符合 Editor 完整类型的 Widget[]                       │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 SchemaAdapter 实现设计

```typescript
// packages/ai/shared/schemaAdapter.ts

import type { Widget, SchemaType } from '@schema-form/editor-web/widgets/base/types'
import type { AIMetadata, WidgetAIMetadata } from '@schema-form/shared-ai/types'

interface PartialWidget {
  type: string
  field?: string
  label?: string
  props?: Record<string, unknown>
  position?: { x: number; y: number; w: number; h: number }
  children?: PartialWidget[]
  options?: Array<{ label: string; value: string | number | boolean }>
  validationRules?: Array<{ required?: boolean; message?: string; trigger?: string }>
  linkages?: Array<{ type: string; watchFields: string[]; condition: string }>
  events?: Array<{ trigger: string; actions: Array<{ type: string; target?: string; value?: unknown }> }>
}

/**
 * 将 AI 生成的简化 Widget 转换为 Editor 完整 Widget。
 *
 * 核心职责：
 * 1. type → name 映射（通过 metadata）
 * 2. 自动生成 formId（遍历容器树）
 * 3. 补全 position 默认值（自动布局算法）
 * 4. 补全 validationRules（从 props 推导）
 * 5. 校验并修复常见错误
 */
export class SchemaAdapter {
  private metadata: AIMetadata
  private typeMap: Map<string, WidgetAIMetadata>
  private nameMap: Map<string, string>  // type → Vue component name

  constructor(metadata: AIMetadata) {
    this.metadata = metadata
    this.typeMap = new Map(metadata.widgets.map(w => [w.type, w]))
    this.nameMap = buildNameMap(metadata)  // input → FgInput, select → FgSelect, ...
  }

  /**
   * 将 AI 输出的 PartialWidget[] 转换为完整的 Widget[]。
   */
  adapt(partialWidgets: PartialWidget[]): Widget[] {
    const widgets = partialWidgets.map(w => this.adaptWidget(w, null, 0))

    // 第二遍：补全容器绑定（formId, tabKey, colIndex）
    this.resolveContainerBindings(widgets, null)

    // 第三遍：自动布局（补全缺失的 position）
    this.autoLayout(widgets)

    // 第四遍：校验 + 修复
    this.validateAndFix(widgets)

    return widgets as Widget[]
  }

  /**
   * 单个 Widget 适配。
   */
  private adaptWidget(partial: PartialWidget, parentId: string | null, depth: number): Partial<Widget> {
    const meta = this.typeMap.get(partial.type)

    const widget: Partial<Widget> = {
      // 基础标识
      id: partial.type + '_' + this.generateId(),
      name: this.nameMap.get(partial.type) ?? 'FgInput',
      type: partial.type as SchemaType,

      // 属性
      field: partial.field,
      label: partial.label,
      props: this.adaptProps(partial, meta),
      options: partial.options,

      // 位置（可能缺失，后续自动布局补全）
      position: partial.position ?? { x: 0, y: 0, w: 0, h: 0 },

      // 容器绑定（第二遍处理）
      formId: undefined,
      tabKey: undefined,
      colIndex: undefined,

      // 校验规则（从 props 推导）
      validationRules: this.adaptValidationRules(partial, meta),

      // 联动规则
      linkages: this.adaptLinkages(partial),

      // 事件
      events: this.adaptEvents(partial, meta),

      // 变量
      variables: [],

      // 子组件
      children: partial.children?.map(c => this.adaptWidget(c, widget.id!, depth + 1)),
    }

    return widget as Widget
  }

  /**
   * 属性适配：将 AI 输出的简化 props 转换为组件期望的完整 props。
   */
  private adaptProps(partial: PartialWidget, meta?: WidgetAIMetadata): Record<string, unknown> {
    const props: Record<string, unknown> = { ...partial.props }

    // 从 defaultProps 补全缺失的属性
    if (meta?.defaultProps) {
      for (const [key, defaultValue] of Object.entries(meta.defaultProps)) {
        if (props[key] === undefined) {
          props[key] = defaultValue
        }
      }
    }

    // 特殊组件的属性转换
    switch (partial.type) {
      case 'select':
      case 'radio':
      case 'checkbox':
        // 确保 options 在 props 中
        if (partial.options && !props.options) {
          props.options = partial.options
        }
        break
      case 'upload':
        // 补全上传配置
        props.action = props.action ?? '/api/upload'
        props.accept = props.accept ?? '.jpg,.png,.pdf'
        break
      case 'date':
      case 'date-time-slot':
        // 补全日期格式
        props.format = props.format ?? 'YYYY-MM-DD'
        props.valueFormat = props.valueFormat ?? 'YYYY-MM-DD'
        break
    }

    return props
  }

  /**
   * 校验规则适配：从 AI 输出和 props 推导完整的 validationRules。
   */
  private adaptValidationRules(partial: PartialWidget, meta?: WidgetAIMetadata): Widget['validationRules'] {
    const rules: Array<Record<string, unknown>> = [...(partial.validationRules ?? [])]

    // 从 props.required 推导必填规则
    if (partial.props?.required && !rules.some(r => r.required)) {
      rules.push({
        required: true,
        message: `请填写${partial.label ?? partial.field ?? ''}`,
        trigger: 'blur',
      })
    }

    // 从 props 推导长度限制
    if (partial.props?.maxlength && !rules.some(r => r.max)) {
      rules.push({
        max: Number(partial.props.maxlength),
        message: `长度不能超过 ${partial.props.maxlength} 个字符`,
        trigger: 'blur',
      })
    }

    // 从 props 推导正则校验
    if (partial.props?.pattern && !rules.some(r => r.pattern)) {
      rules.push({
        pattern: partial.props.pattern,
        message: (partial.props.patternMessage as string) ?? '格式不正确',
        trigger: 'blur',
      })
    }

    return rules as Widget['validationRules']
  }

  /**
   * 联动规则适配：将 AI 输出的简化 linkage 转换为完整的 SchemaLinkage[]。
   */
  private adaptLinkages(partial: PartialWidget): Widget['linkages'] {
    if (!partial.linkages?.length) return undefined

    return partial.linkages.map(linkage => ({
      type: linkage.type as SchemaLinkage['type'],
      watchFields: linkage.watchFields,
      condition: linkage.condition,
    })) as Widget['linkages']
  }

  /**
   * 事件适配：将 AI 输出的简化事件转换为完整的 WidgetEvent[]。
   */
  private adaptEvents(partial: PartialWidget, meta?: WidgetAIMetadata): Widget['events'] {
    if (!partial.events?.length) return undefined

    return partial.events.map(event => ({
      trigger: event.trigger,
      actions: event.actions.map(action => ({
        type: action.type,
        target: action.target,
        value: action.value,
      })),
    })) as Widget['events']
  }

  /**
   * 容器绑定解析：为容器内的组件生成 formId、tabKey、colIndex。
   */
  private resolveContainerBindings(widgets: Partial<Widget>[], parentFormId: string | null): void {
    for (const widget of widgets) {
      // 表单容器：生成 formId
      if (widget.type === 'form') {
        const formId = widget.id!
        widget.formId = formId
        if (widget.children) {
          this.resolveContainerBindings(widget.children as Partial<Widget>[], formId)
        }
      }
      // 标签页容器
      else if (widget.type === 'tabs') {
        if (widget.children) {
          for (let i = 0; i < widget.children.length; i++) {
            const tab = widget.children[i] as Partial<Widget>
            tab.tabKey = tab.id ?? `tab_${i}`
            if (tab.children) {
              this.resolveContainerBindings(tab.children as Partial<Widget>[], parentFormId)
            }
          }
        }
      }
      // 列布局容器
      else if (['single-col', 'double-col', 'triple-col', 'quad-col'].includes(widget.type ?? '')) {
        if (widget.children) {
          for (let i = 0; i < widget.children.length; i++) {
            const child = widget.children[i] as Partial<Widget>
            child.colIndex = i
            child.formId = parentFormId
            if (child.children) {
              this.resolveContainerBindings(child.children as Partial<Widget>[], parentFormId)
            }
          }
        }
      }
      // 普通容器（card 等）
      else if (widget.children) {
        widget.formId = parentFormId
        this.resolveContainerBindings(widget.children as Partial<Widget>[], parentFormId)
      }
      // 基础组件：继承父容器的 formId
      else {
        widget.formId = parentFormId
      }
    }
  }

  /**
   * 自动布局：为缺失 position 的组件生成合理的位置。
   */
  private autoLayout(widgets: Partial<Widget>[]): void {
    let currentY = 0
    const DEFAULT_W = 24  // 满宽
    const DEFAULT_H = 2   // 默认高度

    for (const widget of widgets) {
      if (!widget.position || (widget.position.w === 0 && widget.position.h === 0)) {
        const meta = this.typeMap.get(widget.type ?? '')
        const defaultSize = meta?.defaultSize

        widget.position = {
          x: 0,
          y: currentY,
          w: defaultSize?.w ?? DEFAULT_W,
          h: defaultSize?.h ?? DEFAULT_H,
        }
      }

      currentY += widget.position.h

      // 递归处理子组件
      if (widget.children) {
        this.autoLayout(widget.children as Partial<Widget>[])
      }
    }
  }

  /**
   * 校验并修复常见错误。
   */
  private validateAndFix(widgets: Partial<Widget>[]): void {
    for (const widget of widgets) {
      // 修复：基础组件不能在根层级
      // （由上层调用者确保根级只有容器）

      // 修复：容器必须有 children
      const meta = this.typeMap.get(widget.type ?? '')
      if (meta?.canHaveChildren && !widget.children?.length) {
        widget.children = []
      }

      // 修复：position 不能为负数
      if (widget.position) {
        widget.position.x = Math.max(0, widget.position.x)
        widget.position.y = Math.max(0, widget.position.y)
        widget.position.w = Math.max(1, widget.position.w)
        widget.position.h = Math.max(1, widget.position.h)
      }

      // 递归处理
      if (widget.children) {
        this.validateAndFix(widget.children as Partial<Widget>[])
      }
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 7)
  }
}
```

### 3.4 FlowAdapter 实现设计

```typescript
// packages/ai/shared/flowAdapter.ts

import type { FlowNodeData, FlowEdgeData, FlowGraph } from '@schema-form/flow/shared/types/graph'
import type { BpmnNodeConfig, BpmnElementType } from '@schema-form/flow/shared/types/bpmn'

interface PartialFlowNode {
  id: string
  bpmnType: string
  label: string
  x?: number
  y?: number
  width?: number
  height?: number
  data?: Partial<BpmnNodeConfig>
}

interface PartialFlowEdge {
  id: string
  source: string
  target: string
  label?: string
  conditionExpression?: string
  isDefault?: boolean
}

interface PartialFlowGraph {
  nodes: PartialFlowNode[]
  edges: PartialFlowEdge[]
}

/**
 * 将 AI 生成的简化 FlowGraph 转换为引擎完整的 FlowGraph。
 */
export class FlowAdapter {
  /**
   * 将 AI 输出的 PartialFlowGraph 转换为完整的 FlowGraph。
   */
  adapt(partial: PartialFlowGraph): FlowGraph {
    const nodes = partial.nodes.map(n => this.adaptNode(n))
    const edges = partial.edges.map(e => this.adaptEdge(e))

    // 自动布局（如果节点位置缺失或重叠）
    this.autoLayout(nodes)

    return { nodes, edges }
  }

  private adaptNode(partial: PartialFlowNode): FlowNodeData {
    const DEFAULT_SIZES: Record<string, { width: number; height: number }> = {
      startEvent: { width: 40, height: 40 },
      endEvent: { width: 40, height: 40 },
      userTask: { width: 200, height: 80 },
      serviceTask: { width: 200, height: 80 },
      scriptTask: { width: 200, height: 80 },
      exclusiveGateway: { width: 50, height: 50 },
      parallelGateway: { width: 50, height: 50 },
      inclusiveGateway: { width: 50, height: 50 },
    }

    const size = DEFAULT_SIZES[partial.bpmnType] ?? { width: 200, height: 80 }

    const data: BpmnNodeConfig = {
      bpmnType: partial.bpmnType as BpmnElementType,
      label: partial.label,
      // 审批配置
      approvalMode: partial.data?.approvalMode ?? 'single',
      rejectPolicy: partial.data?.rejectPolicy ?? 'reject-on-any',
      assigneeType: partial.data?.assigneeType ?? 'user',
      candidateUsers: partial.data?.candidateUsers ?? [],
      candidateRoles: partial.data?.candidateRoles ?? [],
      // 表单绑定
      formSchemaId: partial.data?.formSchemaId,
      formPublishId: partial.data?.formPublishId,
      formVersion: partial.data?.formVersion,
      formMode: partial.data?.formMode ?? 'edit',
      // 网关配置
      gatewayDirection: partial.data?.gatewayDirection,
      defaultFlow: partial.data?.defaultFlow,
      // 定时器
      timerType: partial.data?.timerType,
      timerValue: partial.data?.timerValue,
      // 服务任务
      serviceType: partial.data?.serviceType,
      serviceConfig: partial.data?.serviceConfig,
      apiConfig: partial.data?.apiConfig,
      // 通用
      documentation: partial.data?.documentation,
    }

    return {
      id: partial.id,
      shape: 'bpmn-node',
      x: partial.x ?? 0,
      y: partial.y ?? 0,
      width: partial.width ?? size.width,
      height: partial.height ?? size.height,
      data,
    }
  }

  private adaptEdge(partial: PartialFlowEdge): FlowEdgeData {
    return {
      id: partial.id,
      shape: 'bpmn-edge',
      source: { cell: partial.source },
      target: { cell: partial.target },
      data: {
        label: partial.label,
        conditionExpression: partial.conditionExpression,
        isDefault: partial.isDefault,
      },
    }
  }

  /**
   * 自动布局：为节点生成合理的位置（分层布局算法）。
   */
  private autoLayout(nodes: FlowNodeData[]): void {
    // 如果所有节点都有有效位置，跳过
    if (nodes.every(n => n.x > 0 || n.y > 0)) return

    // 简单的分层布局：从左到右
    const H_GAP = 250
    const V_GAP = 100
    let currentX = 50
    let currentY = 100

    for (const node of nodes) {
      if (node.x === 0 && node.y === 0) {
        node.x = currentX
        node.y = currentY
        currentX += H_GAP

        // 换行
        if (currentX > 1000) {
          currentX = 50
          currentY += V_GAP + node.height
        }
      }
    }
  }
}
```

---

## 四、MCP 内部专有实现

### 4.1 设计原则

```
┌─────────────────────────────────────────────────────────────────┐
│  MCP Server = 工具定义的唯一权威源                                │
│  ├── 所有读取/查询/校验工具 → MCP Server                         │
│  ├── 所有 HITL/写入/协作工具 → LangGraph 专有                    │
│  └── 共享业务逻辑层 → services/                                  │
├─────────────────────────────────────────────────────────────────┤
│  MCP 传输层                                                      │
│  ├── SSE（/api/mcp/*）→ 外部客户端                               │
│  └── InMemoryTransport → LangGraph 内部调用                      │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 MCP Server 定义（内部专有）

```typescript
// packages/ai/mcp/servers/schemaServer.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { schemaService } from '../../server/services/schemaService.js'

export function createSchemaServer(): McpServer {
  const server = new McpServer({
    name: 'schema-form-schemas',
    version: '2.0.0',
  })

  // ── schema__search ──
  server.tool(
    'schema__search',
    '搜索表单 Schema 列表，支持按关键词、类型、状态筛选。',
    {
      keyword: z.string().optional().describe('搜索关键词，匹配 Schema 名称'),
      type: z.enum(['form', 'search_list']).optional().describe('Schema 类型'),
      status: z.enum(['draft', 'published']).optional().describe('Schema 状态'),
      limit: z.number().default(10).describe('返回数量上限'),
      source: z.enum(['editor', 'flow']).optional().default('editor')
        .describe('调用来源：editor 返回完整字段，flow 返回精简字段'),
    },
    async (params) => {
      const result = await schemaService.search(params)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  )

  // ── schema__get_detail ──
  server.tool(
    'schema__get_detail',
    '获取 Schema 完整信息，包括 Widget 树、版本历史、元数据。',
    {
      schemaId: z.string().describe('Schema ID'),
    },
    async ({ schemaId }) => {
      const result = await schemaService.getDetail(schemaId)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  )

  // ── schema__validate ──
  server.tool(
    'schema__validate',
    '验证 Schema 文档结构（name/type/json 字段存在性）。',
    {
      schema: z.object({}).passthrough().describe('Schema 对象'),
    },
    async ({ schema }) => {
      const result = schemaService.validateDocument(schema)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  )

  // ── schema__validate_widgets ──
  server.tool(
    'schema__validate_widgets',
    '校验 Widget 数组的结构正确性（类型、ID、position、容器嵌套）。',
    {
      widgets: z.array(z.record(z.unknown())).describe('Widget 数组'),
    },
    async ({ widgets }) => {
      const result = schemaService.validateWidgets(widgets)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  )

  // ── schema__search_published ──
  server.tool(
    'schema__search_published',
    '搜索已发布的 Schema 版本。',
    {
      keyword: z.string().optional().describe('按名称模糊搜索'),
      type: z.enum(['form', 'search_list']).optional().describe('按类型筛选'),
      limit: z.number().default(10).describe('返回数量上限'),
    },
    async (params) => {
      const result = await schemaService.searchPublished(params)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  )

  // ── schema__fuzzy_search ──
  server.tool(
    'schema__fuzzy_search',
    '基于关键词模糊搜索已有 Schema（Jaccard 相似度）。',
    {
      query: z.string().describe('关键词描述'),
      limit: z.number().default(5).describe('返回数量上限'),
    },
    async (params) => {
      const result = await schemaService.fuzzySearch(params)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  )

  // ── schema__find_flow_references ──
  server.tool(
    'schema__find_flow_references',
    '查找引用了指定 Schema 的所有流程节点。',
    {
      schemaId: z.string().describe('Schema ID'),
    },
    async ({ schemaId }) => {
      const result = await schemaService.findFlowReferences(schemaId)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    },
  )

  return server
}
```

### 4.3 MCP → LangGraph 桥接层

```typescript
// packages/ai/mcp/bridge.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { StructuredTool } from '@langchain/core/tools'

/**
 * 创建 MCP 内部客户端（InMemoryTransport 直连，零网络开销）。
 */
async function createInternalClient(factory: () => McpServer): Promise<Client> {
  const server = factory()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)

  const client = new Client(
    { name: 'langgraph-internal', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  await client.connect(clientTransport)

  return client
}

/**
 * 将 MCP Server 的工具列表转换为 LangGraph StructuredTool[]。
 */
async function convertMcpTools(
  client: Client,
  prefix: string,
): Promise<StructuredTool[]> {
  const { tools: mcpTools } = await client.listTools()

  return mcpTools.map((mcpTool) => {
    // 将 MCP inputSchema（JSON Schema）转换为 Zod schema
    const zodSchema = jsonSchemaToZod(mcpTool.inputSchema)

    return tool(
      async (params: Record<string, unknown>) => {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: params,
        })
        // MCP 返回 content 数组，提取 text
        const textContent = result.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text)
          .join('\n')
        return textContent
      },
      {
        name: mcpTool.name,
        description: mcpTool.description ?? '',
        schema: zodSchema,
      },
    )
  })
}

/**
 * 初始化所有 MCP 内部客户端，返回 LangGraph 可用的工具数组。
 *
 * 使用 InMemoryTransport 直连，不经 SSE 传输，零网络开销。
 */
export async function initMcpBridge(): Promise<StructuredTool[]> {
  const { createSchemaServer } = await import('./servers/schemaServer.js')
  const { createFlowServer } = await import('./servers/flowServer.js')
  const { createWidgetServer } = await import('./servers/widgetServer.js')

  const [schemaClient, flowClient, widgetClient] = await Promise.all([
    createInternalClient(createSchemaServer),
    createInternalClient(createFlowServer),
    createInternalClient(createWidgetServer),
  ])

  const [schemaTools, flowTools, widgetTools] = await Promise.all([
    convertMcpTools(schemaClient, 'schema'),
    convertMcpTools(flowClient, 'flow'),
    convertMcpTools(widgetClient, 'widget'),
  ])

  return [...schemaTools, ...flowTools, ...widgetTools]
}

/**
 * JSON Schema → Zod 转换器（简化版）。
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  if (schema.type === 'object' && schema.properties) {
    const shape: Record<string, z.ZodType> = {}
    const required = (schema.required as string[]) ?? []

    for (const [key, prop] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
      let field = jsonSchemaToZod(prop as Record<string, unknown>)
      if (!required.includes(key)) {
        field = field.optional()
      }
      if (prop.description) {
        field = field.describe(prop.description as string)
      }
      shape[key] = field
    }

    return z.object(shape)
  }

  if (schema.type === 'string') return z.string()
  if (schema.type === 'number') return z.number()
  if (schema.type === 'boolean') return z.boolean()
  if (schema.type === 'array') return z.array(z.unknown())

  return z.unknown()
}
```

---

## 五、Prompt 工程：让 LLM 输出兼容大结构

### 5.1 分层 Prompt 策略

```
┌──────────────────────────────────────────────────────────────┐
│  System Prompt（静态，启动时构建）                              │
│  ├── 角色定义                                                │
│  ├── 可用 Widget/FlowNode 元数据（从 metadata.json 读取）     │
│  ├── 输出格式规范                                            │
│  └── 校验规则                                                │
├──────────────────────────────────────────────────────────────┤
│  Context Prompt（动态，每次请求构建）                          │
│  ├── 当前 Schema/Flow 概要                                   │
│  ├── 对话历史摘要                                            │
│  ├── 用户偏好                                                │
│  └── 协作上下文                                              │
├──────────────────────────────────────────────────────────────┤
│  User Prompt（用户输入）                                      │
│  └── 自然语言需求描述                                         │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Editor Agent System Prompt 关键改进

```typescript
// packages/ai/shared/promptBuilder.ts

export function buildEditorSystemPrompt(metadata: AIMetadata): string {
  return `你是 Schema-Form 平台的 Editor 专家，负责生成表单 Schema。

## 输出格式

你必须输出以下 JSON 结构（不要输出其他内容）：

\`\`\`json
{
  "type": "schema_update",
  "widgets": [
    {
      "type": "组件类型",
      "field": "字段名",
      "label": "显示标签",
      "props": { ... },
      "position": { "x": 0, "y": 0, "w": 24, "h": 2 },
      "options": [ ... ],
      "validationRules": [ ... ],
      "linkages": [ ... ],
      "events": [ ... ]
    }
  ]
}
\`\`\`

## 关键规则

1. **type 必须是有效类型**：${metadata.widgets.map(w => w.type).join(', ')}

2. **容器嵌套规则**：
   - 根级必须是容器：form / card / tabs / single-col / double-col / triple-col / quad-col
   - 基础组件只能嵌套在容器内
   - 容器必须有 children 数组

3. **position 格式**：{ "x": 列(0-23), "y": 行, "w": 宽度(1-24), "h": 高度(1-8) }

4. **field 命名规范**：camelCase，如 employeeName、startDate

5. **options 格式**：[{ "label": "显示文本", "value": "值" }]

6. **validationRules 格式**：
   \`\`\`json
   [{ "required": true, "message": "请填写xxx", "trigger": "blur" }]
   \`\`\`

7. **linkages 格式**：
   \`\`\`json
   [{
     "type": "visible",
     "watchFields": ["fieldA"],
     "condition": "values.fieldA === 'yes'"
   }]
   \`\`\`

8. **events 格式**：
   \`\`\`json
   [{
     "trigger": "click",
     "actions": [{ "type": "submit", "target": "form_main" }]
   }]
   \`\`\`

## 可用组件元数据

${metadata.widgets.map(w => `
### ${w.displayName} (${w.type})
- 分组：${w.group}
- 可包含子组件：${w.canHaveChildren}
- 默认尺寸：${w.defaultSize ? `${w.defaultSize.w}x${w.defaultSize.h}` : '无'}
- 关键属性：${w.keyProps.join(', ')}
- 描述：${w.description}
`).join('\n')}

## 输出示例

用户："创建一个请假申请表单"

\`\`\`json
{
  "type": "schema_update",
  "widgets": [
    {
      "type": "form",
      "field": "leaveForm",
      "label": "请假申请",
      "props": {},
      "position": { "x": 0, "y": 0, "w": 24, "h": 20 },
      "children": [
        {
          "type": "input",
          "field": "applicantName",
          "label": "申请人",
          "props": { "placeholder": "请输入姓名", "required": true },
          "position": { "x": 0, "y": 0, "w": 12, "h": 2 },
          "validationRules": [{ "required": true, "message": "请填写申请人", "trigger": "blur" }]
        },
        {
          "type": "select",
          "field": "leaveType",
          "label": "请假类型",
          "props": { "placeholder": "请选择" },
          "position": { "x": 12, "y": 0, "w": 12, "h": 2 },
          "options": [
            { "label": "事假", "value": "personal" },
            { "label": "年假", "value": "annual" },
            { "label": "病假", "value": "sick" }
          ],
          "validationRules": [{ "required": true, "message": "请选择请假类型", "trigger": "change" }]
        },
        {
          "type": "date",
          "field": "startDate",
          "label": "开始日期",
          "props": { "type": "date", "placeholder": "选择日期" },
          "position": { "x": 0, "y": 2, "w": 12, "h": 2 },
          "validationRules": [{ "required": true, "message": "请选择开始日期", "trigger": "change" }]
        },
        {
          "type": "textarea",
          "field": "reason",
          "label": "请假事由",
          "props": { "placeholder": "请填写请假事由", "rows": 3 },
          "position": { "x": 0, "y": 4, "w": 24, "h": 3 }
        }
      ]
    }
  ]
}
\`\`\`
`
}
```

### 5.3 Flow Agent System Prompt 关键改进

```typescript
export function buildFlowSystemPrompt(metadata: AIMetadata): string {
  return `你是 Schema-Form 平台的 Flow 专家，负责生成 BPMN 流程。

## 输出格式

\`\`\`json
{
  "type": "flow_update",
  "flow": {
    "nodes": [
      {
        "id": "uuid",
        "shape": "bpmn-node",
        "x": 100, "y": 100, "width": 40, "height": 40,
        "data": {
          "bpmnType": "startEvent",
          "label": "开始"
        }
      }
    ],
    "edges": [
      {
        "id": "uuid",
        "shape": "bpmn-edge",
        "source": { "cell": "start_1" },
        "target": { "cell": "task_1" },
        "data": {}
      }
    ]
  }
}
\`\`\`

## 关键规则

1. **必须有 startEvent 和 endEvent**

2. **shape 字段必须存在**：
   - 节点：shape: "bpmn-node"
   - 连线：shape: "bpmn-edge"

3. **edge.source/target 格式**：{ "cell": "节点id" }（不是字符串）

4. **userTask 审批配置**：
   \`\`\`json
   {
     "bpmnType": "userTask",
     "label": "经理审批",
     "approvalMode": "single",
     "rejectPolicy": "reject-on-any",
     "assigneeType": "user",
     "candidateUsers": ["user_001"],
     "candidateRoles": []
   }
   \`\`\`

5. **网关条件配置**：
   \`\`\`json
   {
     "bpmnType": "exclusiveGateway",
     "label": "金额判断",
     "gatewayDirection": "diverging",
     "defaultFlow": "edge_default"
   }
   \`\`\`
   对应 edge：
   \`\`\`json
   {
     "id": "edge_condition",
     "source": { "cell": "gateway_1" },
     "target": { "cell": "task_2" },
     "data": { "conditionExpression": "${'${amount > 10000}'}", "label": "金额>1万" }
   }
   \`\`\`

## 节点类型

${metadata.flowNodes.map(n => `- **${n.type}**：${n.description}`).join('\n')}

## 输出示例

用户："设计一个采购审批流程"

\`\`\`json
{
  "type": "flow_update",
  "flow": {
    "nodes": [
      { "id": "start_1", "shape": "bpmn-node", "x": 100, "y": 200, "width": 40, "height": 40, "data": { "bpmnType": "startEvent", "label": "开始" } },
      { "id": "task_1", "shape": "bpmn-node", "x": 250, "y": 180, "width": 200, "height": 80, "data": { "bpmnType": "userTask", "label": "提交申请", "approvalMode": "single", "assigneeType": "expression", "assignee": "${initiator}" } },
      { "id": "gw_1", "shape": "bpmn-node", "x": 550, "y": 200, "width": 50, "height": 50, "data": { "bpmnType": "exclusiveGateway", "label": "金额判断", "gatewayDirection": "diverging", "defaultFlow": "e3" } },
      { "id": "task_2", "shape": "bpmn-node", "x": 700, "y": 120, "width": 200, "height": 80, "data": { "bpmnType": "userTask", "label": "部门经理审批", "approvalMode": "single", "candidateRoles": ["dept_manager"] } },
      { "id": "task_3", "shape": "bpmn-node", "x": 700, "y": 280, "width": 200, "height": 80, "data": { "bpmnType": "userTask", "label": "总经理审批", "approvalMode": "single", "candidateRoles": ["general_manager"] } },
      { "id": "end_1", "shape": "bpmn-node", "x": 1000, "y": 200, "width": 40, "height": 40, "data": { "bpmnType": "endEvent", "label": "结束" } }
    ],
    "edges": [
      { "id": "e1", "shape": "bpmn-edge", "source": { "cell": "start_1" }, "target": { "cell": "task_1" }, "data": {} },
      { "id": "e2", "shape": "bpmn-edge", "source": { "cell": "task_1" }, "target": { "cell": "gw_1" }, "data": {} },
      { "id": "e3", "shape": "bpmn-edge", "source": { "cell": "gw_1" }, "target": { "cell": "task_2" }, "data": { "conditionExpression": "${amount <= 10000}", "label": "金额≤1万" } },
      { "id": "e4", "shape": "bpmn-edge", "source": { "cell": "gw_1" }, "target": { "cell": "task_3" }, "data": { "label": "金额>1万" } },
      { "id": "e5", "shape": "bpmn-edge", "source": { "cell": "task_2" }, "target": { "cell": "end_1" }, "data": {} },
      { "id": "e6", "shape": "bpmn-edge", "source": { "cell": "task_3" }, "target": { "cell": "end_1" }, "data": {} }
    ]
  }
}
\`\`\`
`
}
```

---

## 六、完整数据流

### 6.1 对话 → 表单

```
用户："创建一个请假申请表单，包含请假类型、日期范围、事由"
  ↓
┌─────────────────────────────────────────────────────────────┐
│  1. Router → Editor Agent                                    │
│     context.source = 'editor' 或 auto 模式识别               │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  2. Editor Agent → LLM（deepseek-v4-pro）                    │
│     Input: System Prompt + 用户消息 + 元数据                  │
│     Output: <think> + <answer> + <schema>                       │
│     schema = { type: "schema_update", widgets: [...] }       │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  3. SchemaAdapter.adapt(widgets)                             │
│     ├── type → name 映射（input → FgInput）                  │
│     ├── 自动生成 formId                                      │
│     ├── 补全 position                                        │
│     ├── 补全 validationRules                                 │
│     └── 校验 + 修复                                          │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  4. HITL：update_schema tool → interrupt                     │
│     发送 diff 给前端，等待用户确认                             │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  5. 用户确认 → 保存到 FormSchema + PublishedSchema           │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  6. SSE 推送 schema 事件 → 前端预览 + 可应用到编辑器          │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 对话 → 工作流

```
用户："设计一个采购审批流程，金额超过1万需要总经理审批"
  ↓
Router → Thinker → Flow Agent → FlowAdapter → HITL → 保存
  ↓
SSE 推送 flow 事件 → 前端 Vue Flow 预览
```

### 6.3 对话 → 表单 + 工作流（联动）

```
用户："设计一个采购审批流程，并生成申请表单"
  ↓
Thinker → chain: [
  { agent: "flow", description: "生成采购审批流程" },
  { agent: "editor", description: "生成采购申请表单" }
]
  ↓
Flow Agent 生成流程 → FlowAdapter 适配
  ↓
Editor Agent 生成表单 → SchemaAdapter 适配
  ↓
save_and_bind_schema：表单自动绑定到流程的 userTask 节点
  ↓
Summarizer 汇总结果
```

---

## 七、实施路线图

### Phase 0：基础加固（1 周）

| 任务 | 产出 | 优先级 |
|------|------|--------|
| 熔断保护：ToolNode handleToolErrors | graph.ts 改动 | P0 |
| 工具包装器：withErrorHandling | tools/toolWrapper.ts | P0 |
| 全局循环拦截：nodeExecutionCount | state.ts + graph.ts | P0 |

### Phase 1：Schema 适配层（2 周）

| 任务 | 产出 | 优先级 |
|------|------|--------|
| SchemaAdapter 实现 | ai/shared/schemaAdapter.ts | P0 |
| FlowAdapter 实现 | ai/shared/flowAdapter.ts | P0 |
| promptBuilder 改进（完整输出格式） | ai/shared/promptBuilder.ts | P0 |
| 适配器单元测试 | __tests__/schemaAdapter.spec.ts | P0 |
| Editor Agent 集成适配器 | graph/editorAgent.ts | P1 |
| Flow Agent 集成适配器 | graph/flowAgent.ts | P1 |

### Phase 2：MCP 统一（2 周）

| 任务 | 产出 | 优先级 |
|------|------|--------|
| 提取共享 service 层 | ai/server/services/schemaService.ts 等 | P1 |
| MCP Server 重构（调用 service） | ai/mcp/servers/*.ts | P1 |
| 工具名命名空间 `{domain}__` | 所有 MCP Server | P1 |
| InMemoryTransport 桥接 | ai/mcp/bridge.ts | P1 |
| allTools 重构（MCP + 专有） | ai/mcp/bridge.ts + ai/server/tools/langgraphTools.ts | P1 |
| RAG + Industry MCP Server | ai/mcp/servers/ragServer.ts 等 | P2 |

### Phase 3：模型优化（1 周）

| 任务 | 产出 | 优先级 |
|------|------|--------|
| getModelForTask 修复 | agentBase.ts | P2 |
| temperature/jsonMode 冲突修复 | llmCache.ts | P2 |
| JSON 解析加固 | graph.ts extractJsonFromResponse | P2 |
| 参数健壮性测试 | __tests__/llmParams.spec.ts | P2 |

### Phase 4：项目重组（1 周）

| 任务 | 产出 | 优先级 |
|------|------|--------|
| 创建 packages/ai/ 目录结构 | 目录重组 | P2 |
| 迁移 server/ai/ → ai/server/ | 文件迁移 | P2 |
| 迁移 ai-app/ → ai/app/ | 文件迁移 | P2 |
| 更新 import 路径 | 全项目 | P2 |
| 更新 pnpm workspace | pnpm-workspace.yaml | P2 |

### 总工期：约 7 周

| Phase | 内容 | 工期 |
|-------|------|------|
| Phase 0 | 基础加固 | 1 周 |
| Phase 1 | Schema 适配层 | 2 周 |
| Phase 2 | MCP 统一 | 2 周 |
| Phase 3 | 模型优化 | 1 周 |
| Phase 4 | 项目重组 | 1 周 |

---

## 八、验收标准

### 8.1 对话 → 表单验收

```
输入："创建一个请假申请表单"
验收：
  ✅ AI 输出的 Schema 包含完整 type/field/label/props/position
  ✅ SchemaAdapter 自动补全 name/formId/validationRules
  ✅ 校验通过（validateWidgetSchema 无错误）
  ✅ 可直接应用到编辑器（无缺字段警告）
  ✅ 编辑器可正常渲染表单
  ✅ 表单可正常提交数据
```

### 8.2 对话 → 工作流验收

```
输入："设计一个采购审批流程"
验收：
  ✅ AI 输出的 FlowGraph 包含 shape/data 完整字段
  ✅ FlowAdapter 自动补全 approvalMode/rejectPolicy
  ✅ 校验通过（validateFlow 无错误）
  ✅ 可直接应用到流程设计器（Vue Flow 渲染正确）
  ✅ 流程可正常启动和执行
```

### 8.3 对话 → 联动验收

```
输入："设计采购审批流程并生成申请表单"
验收：
  ✅ 任务链正确拆分为 [flow, editor]
  ✅ 流程和表单分别生成
  ✅ 表单自动绑定到流程的 userTask 节点
  ✅ Summarizer 正确汇总结果
```
