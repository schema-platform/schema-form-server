# API 接口文档

基础路径：`/api`

所有响应统一格式：
```ts
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: { message: string; details?: unknown }
}
```

> **ID 格式**: 所有资源 ID 为 MongoDB ObjectId（24 位十六进制字符串），如 `685faa86c32e0839b4f9de6f`。

## 认证

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/auth/login` | 登录 | 否 |
| POST | `/auth/register` | 注册 | 否 |
| GET | `/auth/me` | 当前用户信息 | 是 |
| POST | `/auth/logout` | 登出 | 是 |
| POST | `/auth/refresh` | 刷新 Token | 否 |
| POST | `/auth/change-password` | 修改密码 | 是 |

## Schema 管理

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/schemas` | 列表（支持 search/type/status 分页） | 是 |
| POST | `/schemas` | 创建 | 是 |
| GET | `/schemas/:id` | 详情 | 是 |
| PUT | `/schemas/:id` | 更新 | 是 |
| DELETE | `/schemas/:id` | 删除 | 是 |
| POST | `/schemas/import` | 导入 Schema | 是 |
| GET | `/schemas/published` | 已发布列表 | 是 |
| GET | `/schemas/published/:sourceId` | 按 sourceId 查看已发布 | 是 |
| POST | `/schemas/:id/publish` | 发布 Schema | 是 |
| GET | `/schemas/:param/versions` | 版本列表 | 是 |
| GET | `/schemas/:param/versions/:version` | 指定版本 | 是 |
| DELETE | `/schemas/:param/versions/:version` | 删除版本 | 是 |

## 模板

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/templates` | 列表（支持 search/category/tag 分页） | 否 |
| POST | `/templates` | 创建 | 是 |
| GET | `/templates/:id` | 详情 | 否 |
| PUT | `/templates/:id` | 更新 | 是 |
| DELETE | `/templates/:id` | 删除 | 是 |
| POST | `/templates/:id/apply` | 应用模板（返回克隆的 widgets） | 否 |

## 表单提交

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/submissions/:schemaId` | 提交表单数据 | 是 |
| GET | `/submissions/:schemaId` | 查询提交（分页+状态筛选） | 是 |
| GET | `/submissions/:schemaId/:id` | 获取单条提交 | 是 |
| PATCH | `/submissions/:schemaId/:id/status` | 更新状态 | 是 |
| DELETE | `/submissions/:schemaId/:id` | 删除提交 | 是 |
| GET | `/submissions/:schemaId/export` | 导出 CSV/Excel | 是 |
| POST | `/submissions/:schemaId/batch/delete` | 批量删除 | 是 |
| POST | `/submissions/:schemaId/batch/status` | 批量更新状态 | 是 |

## 流程

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/flows` | 流程定义列表 | 是 |
| POST | `/flows` | 创建流程定义 | 是 |
| GET | `/flows/:id` | 流程定义详情 | 是 |
| PUT | `/flows/:id` | 更新流程定义 | 是 |
| DELETE | `/flows/:id` | 删除流程定义 | 是 |
| POST | `/flows/:id/publish` | 发布流程 | 是 |
| POST | `/flows/:id/archive` | 归档流程 | 是 |
| GET | `/flows/:definitionId/versions` | 版本列表 | 是 |
| POST | `/flows/:definitionId/versions` | 保存版本 | 是 |
| POST | `/flow-instances` | 启动流程实例 | 是 |
| GET | `/flow-instances` | 实例列表 | 是 |
| GET | `/flow-instances/:id` | 实例详情 | 是 |
| POST | `/flow-instances/:id/cancel` | 取消实例 | 是 |
| GET | `/flow-instances/:id/graph` | 获取流程图 | 是 |
| GET | `/flow-tasks/my` | 我的待办任务 | 是 |
| POST | `/flow-tasks/:id/complete` | 完成任务 | 是 |
| POST | `/flow-tasks/:id/reject` | 驳回任务 | 是 |

## 系统管理

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/menus` | 菜单列表（支持 `?tree=true`） | 是 |
| GET | `/menus/route` | 当前用户可见菜单树 | 是 |
| GET | `/users` | 用户列表 | 是 |
| GET | `/roles` | 角色列表 | 是 |
| GET | `/roles/permissions` | 可用权限列表 | 是 |
| GET | `/depts` | 部门列表（支持 `?tree=true`） | 是 |
| GET | `/posts` | 岗位列表 | 是 |
| GET | `/dict/types` | 字典类型列表 | 是 |
| GET | `/dict/data/by-type/:code` | 按编码查询字典数据 | 是 |
| GET | `/micro-apps` | 微应用列表 | 是 |
| GET | `/model-configs` | 模型配置列表 | 是 |
| GET | `/tenants` | 租户列表 | 是 |
| GET | `/config` | 系统参数列表 | 是 |
| GET | `/audit-logs` | 审计日志列表 | 是 |
| GET | `/login-logs` | 登录日志列表 | 是 |
| GET | `/online-users` | 在线用户列表 | 是 |

## Webhook

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/webhooks` | 创建 Webhook | 是 |
| GET | `/webhooks` | Webhook 列表 | 是 |
| GET | `/webhooks/:id` | 获取 Webhook | 是 |
| PUT | `/webhooks/:id` | 更新 Webhook | 是 |
| DELETE | `/webhooks/:id` | 删除 Webhook | 是 |
| GET | `/webhooks/:id/logs` | 发送日志 | 是 |
| POST | `/webhooks/:webhookId/trigger` | 外部触发（HMAC 签名） | 否 |

## AI 能力

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/ai/chat` | SSE 流式对话 | 是 |
| GET | `/ai/conversations` | 对话列表 | 是 |
| GET | `/ai/conversations/:id` | 对话详情 | 是 |
| GET | `/ai/rag/search` | RAG 语义搜索 | 是 |
| GET | `/ai/plugins` | 插件列表 | 是 |
| GET | `/ai/prompts` | 提示词模板列表 | 是 |
| GET | `/ai/health` | AI 健康检查 | 是 |
| GET | `/ai/monitor/stats` | Agent 性能统计 | 是 |

## 健康检查

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/health` | 健康检查（含 DB ping） | 否 |
