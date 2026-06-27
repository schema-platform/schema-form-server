# 数据模型

MongoDB 通过 Mongoose ODM 访问。所有模型位于 `src/models/`。

## 核心模型

### FormSchema

表单 Schema 实例（编辑器的主要资源）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String (UUID) | 主键 |
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
| `_id` | String (UUID) | 主键 |
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
| `_id` | String (UUID) | 主键 |
| `name` | String | 模板名称 |
| `description` | String | 描述 |
| `category` | String | `form`/`table`/`search`/`layout`/`chart`/`business`/`report`/`other` |
| `widgets` | Mixed[] | Widget 数组 |
| `tags` | String[] | 标签 |
| `isBuiltin` | Boolean | 是否内置模板 |
| `usageCount` | Number | 使用次数 |
| `tenantId` | String | 租户 ID |

### FlowDefinition

流程定义。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String (UUID) | 主键 |
| `name` | String | 流程名称 |
| `description` | String | 描述 |
| `bpmnXml` | String | BPMN XML |
| `currentVersion` | Number | 当前版本号 |
| `status` | String | `draft`/`active`/`inactive` |
| `tenantId` | String | 租户 ID |

### FlowInstance

流程运行实例。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String (UUID) | 主键 |
| `flowId` | String | 关联的 FlowDefinition ID |
| `version` | Number | 使用的版本号 |
| `status` | String | `running`/`completed`/`cancelled` |
| `variables` | Mixed | 流程变量 |
| `currentNode` | String | 当前节点 ID |
| `tenantId` | String | 租户 ID |

## 系统模型

### User / Role / Permission

用户、角色、权限三表联动。

### Menu

动态菜单树，支持 `microAppId` 绑定微应用。

### DictType / DictData

字典管理（类型 + 数据项）。

### Tenant / Dept / Post

租户、部门、岗位组织架构。

### ModelConfig

AI 模型配置（DeepSeek、GPT 等）。

### AuditLog / NodeExecutionLog

操作日志、节点执行日志。
