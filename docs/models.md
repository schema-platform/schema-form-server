# 数据模型

MongoDB 通过 Mongoose ODM 访问。所有模型位于 `src/models/`（基础模型）、`src/flow-models/`（流程模型）、`src/ai/models/`（AI 模型）。

> **主键说明**: 所有模型使用 MongoDB 原生 ObjectId 作为 `_id` 主键，Mongoose `toJSON` 时自动转换为字符串 `id` 字段。

## 核心模型

### FormSchema

表单 Schema 实例（编辑器的主要资源）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键 |
| `name` | String | 名称 |
| `type` | String | `form` / `search_list` |
| `status` | String | `draft` / `published` |
| `json` | Mixed | Schema 树结构（Widget[]） |
| `publishId` | String | 发布版本标识 |
| `version` | String | 版本号 |
| `editId` | String | 编辑态标识 |
| `tenantId` | String | 租户 ID |
| `createdAt` | Date | 创建时间 |
| `updatedAt` | Date | 更新时间 |

### PublishedSchema

已发布的 Schema（快照）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键 |
| `sourceId` | String | 关联的 FormSchema ID |
| `name` | String | 名称 |
| `json` | Mixed | Schema 快照 |
| `publishId` | String | 唯一发布标识 |
| `version` | String | 版本号 |
| `tenantId` | String | 租户 ID |

### WidgetTemplate

组件模板库。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键 |
| `name` | String | 模板名称 |
| `description` | String | 描述 |
| `category` | String | `form`/`table`/`search`/`layout`/`chart`/`business`/`report`/`other` |
| `widgets` | Mixed[] | Widget 数组 |
| `tags` | String[] | 标签 |
| `isBuiltin` | Boolean | 是否内置模板 |
| `usageCount` | Number | 使用次数 |
| `tenantId` | String | 租户 ID |

### FormSubmission

表单提交数据。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键 |
| `schemaId` | String | 关联的 FormSchema ID |
| `data` | Mixed | 提交的表单数据 |
| `status` | String | `submitted`/`approved`/`rejected` |
| `submitterId` | String | 提交者 ID |
| `submitterName` | String | 提交者姓名 |
| `tenantId` | String | 租户 ID |

## 流程模型

### FlowDefinition

流程定义。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键 |
| `name` | String | 流程名称 |
| `description` | String | 描述 |
| `bpmnXml` | String | BPMN XML |
| `currentVersion` | Number | 当前版本号 |
| `status` | String | `draft`/`active`/`inactive` |
| `tenantId` | String | 租户 ID |

### FlowVersion

流程版本。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键 |
| `definitionId` | String | 关联的 FlowDefinition ID |
| `version` | Number | 版本号 |
| `bpmnXml` | String | BPMN XML 快照 |
| `nodeConfigs` | Mixed | 节点配置 |
| `tenantId` | String | 租户 ID |

### FlowInstance

流程运行实例。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键 |
| `flowId` | String | 关联的 FlowDefinition ID |
| `version` | Number | 使用的版本号 |
| `status` | String | `running`/`completed`/`cancelled` |
| `variables` | Mixed | 流程变量 |
| `currentNode` | String | 当前节点 ID |
| `tenantId` | String | 租户 ID |

### TaskInstance

任务实例。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键 |
| `instanceId` | String | 关联的 FlowInstance ID |
| `nodeId` | String | 节点 ID |
| `name` | String | 任务名称 |
| `assignees` | String[] | 处理人列表 |
| `status` | String | `pending`/`claimed`/`completed`/`rejected` |
| `tenantId` | String | 租户 ID |

### ApprovalLog

审批日志。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键 |
| `instanceId` | String | 流程实例 ID |
| `nodeId` | String | 节点 ID |
| `action` | String | `approve`/`reject`/`delegate` |
| `operatorId` | String | 操作人 ID |
| `comment` | String | 审批意见 |
| `tenantId` | String | 租户 ID |

## 系统模型

### User

用户账户（JWT 认证）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | ObjectId | 主键 |
| `username` | String | 用户名（唯一） |
| `password` | String | bcrypt 哈希密码 |
| `displayName` | String | 显示名称 |
| `roles` | String[] | 角色 ID 列表 |
| `deptId` | String | 部门 ID |
| `tenantId` | String | 租户 ID |
| `status` | Number | 状态 |

### Role / Permission

角色-权限映射，RBAC 模型。

### Menu

动态菜单树，支持 `microAppId` 绑定微应用。`parentId` 用于构建树形结构。

### DictType / DictData

字典管理（类型 + 数据项）。

### Tenant / Dept / Post

租户、部门、岗位组织架构。

### ModelConfig

AI 模型配置（DeepSeek、GPT 等）。

### AuditLog / NodeExecutionLog

操作日志、节点执行日志。

### Webhook / WebhookLog

Webhook 配置与发送日志。

### Credential

加密存储第三方凭证。

### MicroApp

qiankun 微前端应用注册。

## ID 校验

所有路由参数中的 ID 校验统一使用 `mongoose.Types.ObjectId.isValid(id)`，不再使用 UUID 校验。
