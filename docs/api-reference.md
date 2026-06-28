# API 接口文档

> 最后更新: 2026-06-28
>
> Base URL: `http://localhost:3001`
>
> 认证方式: `Authorization: Bearer <token>` 或 `X-API-Key: sk-xxx`

---

## 目录

- [1. 健康检查](#1-健康检查)
- [2. 认证](#2-认证)
- [3. SSO 单点登录](#3-sso-单点登录)
- [4. Schema 管理](#4-schema-管理)
- [5. 用户管理](#5-用户管理)
- [6. 角色管理](#6-角色管理)
- [7. 部门管理](#7-部门管理)
- [8. 菜单管理](#8-菜单管理)
- [9. 岗位管理](#9-岗位管理)
- [10. 字典管理](#10-字典管理)
- [11. 系统参数](#11-系统参数)
- [12. 租户管理](#12-租户管理)
- [13. 组件模板](#13-组件模板)
- [14. 表单提交](#14-表单提交)
- [15. Webhook](#15-webhook)
- [16. API Key](#16-api-key)
- [17. 凭证管理](#17-凭证管理)
- [18. LLM 模型配置](#18-llm-模型配置)
- [19. 微前端应用](#19-微前端应用)
- [20. 审计日志](#20-审计日志)
- [21. 登录日志](#21-登录日志)
- [22. 在线用户](#22-在线用户)
- [23. 文件上传](#23-文件上传)
- [24. 仪表盘统计](#24-仪表盘统计)
- [25. 辅助接口](#25-辅助接口)
- [26. 流程定义](#26-流程定义)
- [27. 流程版本](#27-流程版本)
- [28. 流程实例](#28-流程实例)
- [29. 流程任务](#29-流程任务)
- [30. 审批日志](#30-审批日志)
- [31. 流程消息](#31-流程消息)
- [32. 流程通知](#32-流程通知)
- [33. 流程模板](#33-流程模板)
- [34. 流程监控](#34-流程监控)
- [35. 流程定时器](#35-流程定时器)
- [36. AI 核心](#36-ai-核心)
- [37. AI 健康检查](#37-ai-健康检查)
- [38. AI 监控](#38-ai-监控)
- [39. AI 插件市场](#39-ai-插件市场)
- [40. RAG 知识库](#40-rag-知识库)
- [41. LLM Provider](#41-llm-provider)
- [42. AI 协作](#42-ai-协作)
- [43. 提示词模板](#43-提示词模板)
- [44. AI 运行时决策](#44-ai-运行时决策)

---

## 1. 健康检查

### `GET /api/health`

返回服务状态、运行时间、数据库连接状态。

**认证**: 无

**响应**:
```json
{
  "status": "ok",
  "uptime": 12345,
  "database": "connected"
}
```

---

## 2. 认证

### `POST /api/auth/login`

用户登录，支持 `tenantCode` 或 `X-Tenant-Id` 解析租户。

**认证**: 无

**请求体**:
```json
{
  "username": "admin",
  "password": "admin123",
  "tenantCode": "default"
}
```

**响应**:
```json
{
  "token": "eyJ...",
  "refreshToken": "eyJ...",
  "user": {
    "id": "...",
    "username": "admin",
    "displayName": "管理员",
    "roles": ["admin"]
  }
}
```

### `POST /api/auth/refresh`

刷新 access token。

**请求体**:
```json
{
  "refreshToken": "eyJ..."
}
```

### `POST /api/auth/logout`

登出，清除 token 黑名单和 SSO 会话。

**认证**: Bearer Token

### `GET /api/auth/me`

获取当前用户信息及权限。

**认证**: Bearer Token

**响应**:
```json
{
  "user": {
    "id": "...",
    "username": "admin",
    "displayName": "管理员",
    "roles": ["admin"],
    "permissions": ["system:user:list", "..."]
  }
}
```

### `POST /api/auth/register`

用户自主注册（开放接口）。

**请求体**:
```json
{
  "username": "newuser",
  "password": "pass123",
  "displayName": "新用户"
}
```

### `POST /api/auth/change-password`

修改密码。

**认证**: Bearer Token

**请求体**:
```json
{
  "oldPassword": "old123",
  "newPassword": "new456"
}
```

---

## 3. SSO 单点登录

OAuth2 授权码模式。

### `GET /api/auth/sso/authorize`

SSO 授权端点。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| client_id | string | 是 | OAuth 客户端 ID |
| redirect_uri | string | 是 | 回调地址 |
| response_type | string | 是 | 固定 `code` |
| scope | string | 否 | 权限范围 |
| state | string | 否 | 防 CSRF 状态码 |

### `POST /api/auth/sso/token`

用授权码换 token。

**请求体**:
```json
{
  "grant_type": "authorization_code",
  "code": "...",
  "client_id": "...",
  "client_secret": "...",
  "redirect_uri": "..."
}
```

### `POST /api/auth/sso/refresh`

Token 轮换。

### `GET /api/auth/sso/session`

检查 SSO 会话状态。

### `POST /api/auth/sso/logout`

销毁 SSO 会话。

---

## 4. Schema 管理

### `GET /api/schemas`

Schema 列表（分页 + 搜索 + 类型筛选）。

**参数**:
| 参数 | 类型 | 说明 |
|---|---|---|
| page | number | 页码 |
| pageSize | number | 每页数量 |
| keyword | string | 搜索关键词 |
| type | string | Schema 类型筛选 |

### `POST /api/schemas`

创建 Schema。

**请求体**:
```json
{
  "name": "请假表单",
  "type": "form",
  "json": { "widgets": [...] }
}
```

### `POST /api/schemas/import`

导入 Schema（深度校验 widget 树 + ID 重生成）。

### `GET /api/schemas/published`

已发布 Schema 列表。

### `GET /api/schemas/published/:sourceId`

按 sourceId 查看已发布 Schema。

### `GET /api/schemas/published/by-publish-id/:publishId`

按 publishId 查看已发布 Schema。

### `GET /api/schemas/:param/versions`

查看 Schema 版本历史。

### `GET /api/schemas/:param/versions/:version`

查看特定版本。

### `DELETE /api/schemas/:param/versions/:version`

删除特定版本（不能删当前版本）。

### `GET /api/schemas/:id`

获取单个 Schema。

### `PUT /api/schemas/:id`

更新 Schema（自动推入版本快照，最多15个）。

### `POST /api/schemas/:id/publish`

发布 Schema（可指定版本）。

### `DELETE /api/schemas/:id`

删除 Schema（同时删除已发布版本）。

---

## 5. 用户管理

### `GET /api/users`

用户列表（分页 + 搜索 + 租户/部门/状态/角色筛选）。

**参数**:
| 参数 | 类型 | 说明 |
|---|---|---|
| page | number | 页码 |
| pageSize | number | 每页数量 |
| keyword | string | 搜索关键词 |
| tenantId | string | 租户 ID |
| deptId | string | 部门 ID |
| status | number | 状态 |
| roleId | string | 角色 ID |

### `GET /api/users/:id`

获取单个用户。

### `POST /api/users`

创建用户。

**请求体**:
```json
{
  "username": "user1",
  "password": "pass123",
  "displayName": "用户1",
  "roles": ["role_id"],
  "deptId": "dept_id",
  "email": "user1@example.com"
}
```

### `PUT /api/users/:id`

更新用户。

### `DELETE /api/users/:id`

删除用户。

### `PUT /api/users/:id/password`

重置用户密码。

### `GET /api/users/export`

导出用户为 Excel。

### `POST /api/users/import`

从 Excel 导入用户。

---

## 6. 角色管理

### `GET /api/roles/permissions`

获取可用权限列表（按模块分组）。

### `GET /api/roles`

角色列表（分页 + 搜索）。

### `GET /api/roles/:id`

获取单个角色。

### `POST /api/roles`

创建角色（含权限、数据范围）。

**请求体**:
```json
{
  "name": "管理员",
  "description": "系统管理员",
  "permissions": ["system:user:list", "..."],
  "data_scope": "all",
  "dept_ids": []
}
```

### `PUT /api/roles/:id`

更新角色。

### `DELETE /api/roles/:id`

删除角色（自动从用户中移除）。

### `GET /api/roles/:id/users`

获取角色下的用户。

---

## 7. 部门管理

### `GET /api/depts`

部门列表（支持 `?tree=true` 树形返回）。

### `GET /api/depts/:id`

获取单个部门。

### `POST /api/depts`

创建部门。

### `PUT /api/depts/:id`

更新部门。

### `PATCH /api/depts/:id/move`

移动部门（含循环检测）。

**请求体**:
```json
{
  "parentId": "new_parent_id"
}
```

### `DELETE /api/depts/:id`

删除部门（有子部门或关联用户时拒绝）。

---

## 8. 菜单管理

### `GET /api/menus`

菜单列表（支持 `?tree=true`）。

### `GET /api/menus/route`

当前用户可见菜单树（前端动态路由）。

### `GET /api/menus/:id`

获取单个菜单。

### `POST /api/menus`

创建菜单。

### `PUT /api/menus/:id`

更新菜单（含循环检测）。

### `DELETE /api/menus/:id`

删除菜单。

---

## 9. 岗位管理

### `GET /api/posts`

岗位列表（分页 + 搜索）。

### `GET /api/posts/all`

所有启用岗位（下拉用）。

### `GET /api/posts/:id`

获取单个岗位。

### `POST /api/posts`

创建岗位。

### `PUT /api/posts/:id`

更新岗位。

### `DELETE /api/posts/:id`

删除岗位。

---

## 10. 字典管理

### `GET /api/dict/types`

字典类型列表。

### `GET /api/dict/types/:id`

获取字典类型。

### `POST /api/dict/types`

创建字典类型。

### `PUT /api/dict/types/:id`

更新字典类型。

### `DELETE /api/dict/types/:id`

删除字典类型（级联删除数据）。

### `GET /api/dict/data`

字典数据列表。

### `GET /api/dict/data/by-type/:code`

按类型编码获取数据项（公开接口）。

### `GET /api/dict/data/:id`

获取字典数据。

### `POST /api/dict/data`

创建字典数据。

### `PUT /api/dict/data/:id`

更新字典数据。

### `DELETE /api/dict/data/:id`

删除字典数据。

---

## 11. 系统参数

### `GET /api/config`

参数列表。

### `GET /api/config/key/:key`

按 key 查询参数值。

### `GET /api/config/:id`

获取参数。

### `POST /api/config`

创建参数。

### `PUT /api/config/:id`

更新参数。

### `DELETE /api/config/:id`

删除参数。

---

## 12. 租户管理

### `GET /api/tenants`

租户列表。

### `GET /api/tenants/:id`

获取租户。

### `POST /api/tenants`

创建租户（自动初始化默认角色/管理员/菜单）。

### `PUT /api/tenants/:id`

更新租户。

### `DELETE /api/tenants/:id`

删除租户。

---

## 13. 组件模板

### `GET /api/templates`

模板列表（搜索 + 分类 + 标签 + 组件类型筛选）。

### `POST /api/templates`

创建模板。

### `GET /api/templates/:id`

获取模板。

### `PUT /api/templates/:id`

更新模板。

### `DELETE /api/templates/:id`

删除模板。

### `POST /api/templates/:id/apply`

应用模板（返回带重生成 ID 的 widgets）。

---

## 14. 表单提交

### `POST /api/submissions/:schemaId`

提交表单数据。

### `GET /api/submissions/:schemaId`

查询提交（分页 + 状态筛选）。

### `GET /api/submissions/:schemaId/export`

导出为 CSV/Excel。

### `GET /api/submissions/:schemaId/:id`

获取单条提交。

### `PATCH /api/submissions/:schemaId/:id/status`

更新提交状态（审批/驳回）。

### `DELETE /api/submissions/:schemaId/:id`

删除提交。

### `POST /api/submissions/:schemaId/batch/delete`

批量删除。

### `POST /api/submissions/:schemaId/batch/status`

批量更新状态。

---

## 15. Webhook

### `POST /api/webhooks`

创建 Webhook。

**请求体**:
```json
{
  "name": "流程触发",
  "url": "https://example.com/hook",
  "events": ["schema.published"],
  "secret": "my_secret",
  "flowDefinitionId": "flow_id",
  "bodyMapping": {}
}
```

### `GET /api/webhooks`

Webhook 列表。

### `GET /api/webhooks/:id`

获取 Webhook。

### `PUT /api/webhooks/:id`

更新 Webhook。

### `DELETE /api/webhooks/:id`

删除 Webhook。

### `GET /api/webhooks/:id/logs`

发送日志。

### `POST /api/webhooks/:webhookId/trigger`

外部触发 Webhook（HMAC 签名验证 → 启动流程实例）。

### `GET /api/webhooks/:webhookId/trigger`

GET 方式触发（查询参数 HMAC 验证）。

---

## 16. API Key

### `POST /api/keys`

创建 API Key（返回完整 key，仅此一次）。

### `GET /api/keys`

API Key 列表（脱敏）。

### `GET /api/keys/:id`

获取 API Key 详情。

### `DELETE /api/keys/:id`

删除 API Key。

### `PATCH /api/keys/:id/status`

启用/禁用。

---

## 17. 凭证管理

加密存储第三方凭证。

### `GET /api/credentials`

凭证列表（不含 data）。

### `POST /api/credentials`

创建凭证（data 加密存储）。

### `GET /api/credentials/:id`

获取凭证详情（data 解密）。

### `PUT /api/credentials/:id`

更新凭证。

### `DELETE /api/credentials/:id`

删除凭证。

---

## 18. LLM 模型配置

### `GET /api/model-configs`

模型配置列表。

### `POST /api/model-configs`

创建模型配置。

### `GET /api/model-configs/:id`

获取模型配置。

### `PUT /api/model-configs/:id`

更新模型配置。

### `DELETE /api/model-configs/:id`

删除模型配置。

### `POST /api/model-configs/:id/test`

测试模型连通性。

---

## 19. 微前端应用

### `GET /api/micro-apps`

微应用列表。

### `GET /api/micro-apps/:id`

获取微应用。

### `POST /api/micro-apps`

创建微应用。

### `PUT /api/micro-apps/:id`

更新微应用。

### `DELETE /api/micro-apps/:id`

删除微应用。

---

## 20. 审计日志

### `GET /api/audit-logs`

日志列表（多维筛选）。

### `GET /api/audit-logs/:id`

日志详情（含请求体）。

### `GET /api/audit-logs/modules/list`

获取所有模块名。

---

## 21. 登录日志

### `GET /api/login-logs`

登录日志列表。

### `DELETE /api/login-logs`

清空登录日志。

---

## 22. 在线用户

### `GET /api/online-users`

在线用户列表（基于 SSO 会话）。

### `DELETE /api/online-users/:sessionId`

强制下线。

---

## 23. 文件上传

### `POST /api/files/upload/image`

图片上传（5MB 限制）。

### `POST /api/files/upload/avatar`

头像上传。

### `POST /api/files/upload/file`

通用文件上传（20MB 限制）。

### `GET /api/files/:subdir/:filename`

静态文件访问。

---

## 24. 仪表盘统计

### `GET /api/stats`

平台聚合统计（Schema/Flow/AI/活动）。

### `GET /api/stats/conversations`

最近 AI 对话列表。

---

## 25. 辅助接口

### `GET /api/data`

Mock 数据（200条模拟记录，支持分页+过滤）。

### `GET /api/options`

静态选项数据（城市/部门/角色/技能等，支持树形）。

### `GET /api/mock`

根据 Schema 生成模拟表单数据。

### `GET /api/docs`

Swagger UI 页面。

### `GET /api/docs.json`

OpenAPI JSON 规范。

### `GET /api/mcp`

MCP (Model Context Protocol) SSE 传输。

---

## 26. 流程定义

### `GET /api/flows`

流程定义列表。

### `POST /api/flows`

创建流程定义。

### `GET /api/flows/:id`

获取流程定义。

### `PUT /api/flows/:id`

更新流程定义。

### `DELETE /api/flows/:id`

删除流程定义。

### `POST /api/flows/:id/publish`

发布流程。

### `POST /api/flows/:id/archive`

归档流程。

---

## 27. 流程版本

### `GET /api/flows/:definitionId/versions`

版本列表。

### `POST /api/flows/:definitionId/versions`

保存新版本。

### `GET /api/flows/:definitionId/versions/:versionId`

获取特定版本。

---

## 28. 流程实例

### `GET /api/flow-instances/stats`

实例状态统计（支持时间范围）。

### `POST /api/flow-instances`

启动流程实例。

### `GET /api/flow-instances`

实例列表。

### `GET /api/flow-instances/:id`

实例详情。

### `POST /api/flow-instances/:id/cancel`

取消实例。

### `GET /api/flow-instances/:id/graph`

获取流程图。

### `GET /api/flow-instances/:id/state`

获取执行状态。

### `GET /api/flow-instances/:id/logs`

获取审批日志。

---

## 29. 流程任务

### `GET /api/flow-tasks/my`

我的待办任务。

### `GET /api/flow-tasks/:id`

任务详情。

### `POST /api/flow-tasks/:id/claim`

认领任务。

### `POST /api/flow-tasks/:id/complete`

完成任务（通过）。

### `POST /api/flow-tasks/:id/reject`

驳回任务。

### `POST /api/flow-tasks/:id/reject-to-node`

驳回到指定节点。

### `POST /api/flow-tasks/:id/delegate`

委派任务。

### `GET /api/flow-tasks/:id/reject-targets`

获取驳回目标节点列表。

### `POST /api/flow-tasks/batch/approve`

批量审批通过。

### `POST /api/flow-tasks/batch/reject`

批量驳回。

### `POST /api/flow-tasks/batch/delegate`

批量委派。

---

## 30. 审批日志

### `GET /api/flow-approvals`

查询审批日志（按 instanceId）。

### `GET /api/flow-export/approval-logs`

导出审批日志为 CSV/Excel。

---

## 31. 流程消息

### `POST /api/flow-messages`

发送消息到通道（外部触发）。

### `POST /api/flow-messages/complete`

完成消息任务。

---

## 32. 流程通知

### `GET /api/flow/notifications`

通知列表（分页 + 未读筛选）。

### `GET /api/flow/notifications/unread-count`

未读通知数。

### `PUT /api/flow/notifications/:id/read`

标记已读。

### `PUT /api/flow/notifications/read-all`

全部已读。

---

## 33. 流程模板

### `GET /api/flow-templates`

流程模板列表。

### `POST /api/flow-templates`

创建流程模板。

### `GET /api/flow-templates/:id`

获取模板。

### `PUT /api/flow-templates/:id`

更新模板。

### `DELETE /api/flow-templates/:id`

删除模板。

### `POST /api/flow-templates/:id/apply`

应用模板（创建流程定义+版本）。

### `POST /api/flow-templates/seed`

种子内置模板。

---

## 34. 流程监控

### `GET /api/flow-monitor/overview`

监控概览。

### `GET /api/flow-monitor/bottleneck`

瓶颈分析。

### `GET /api/flow-monitor/trends`

趋势分析。

---

## 35. 流程定时器

### `GET /api/flow-timers/check`

检查并触发到期定时器（Cron 调用）。

---

## 36. AI 核心

### `POST /api/ai/chat`

SSE 流式对话（LangGraph streamEvents，多 Agent 路由）。

**请求体**:
```json
{
  "message": "帮我创建一个请假表单",
  "conversationId": "optional_thread_id"
}
```

**SSE 事件类型**: thinking, text, tool_call, schema, flow, diff, error

### `GET /api/ai/chat/interrupt/:threadId`

检查 HITL 中断状态。

### `POST /api/ai/chat/resume`

恢复 HITL 中断（确认/取消）。

### `POST /api/ai/publish`

发布 AI 生成的 Schema/Flow。

### `GET /api/ai/conversations`

对话列表。

### `GET /api/ai/conversations/search`

搜索对话。

### `GET /api/ai/conversations/:id`

对话详情。

### `DELETE /api/ai/conversations/:id`

删除对话。

### `POST /api/ai/messages/:id/feedback`

消息反馈（正面/负面）。

### `GET /api/ai/conversations/:id/versions`

版本历史。

### `GET /api/ai/versions/compare`

版本对比（结构化 diff）。

### `GET /api/ai/versions/:versionId`

获取版本内容。

### `POST /api/ai/conversations/:id/rollback`

回滚到指定版本。

### `GET /api/ai/rag/search`

RAG 语义搜索。

### `GET /api/ai/industries`

行业 Agent 列表。

### `GET /api/ai/industries/:industry/templates`

行业模板。

### `POST /api/ai/behavior`

记录用户行为。

### `POST /api/ai/behavior/batch`

批量记录行为。

### `GET /api/ai/behavior/preferences`

获取用户偏好。

### `GET /api/ai/behavior/stats`

行为统计。

### `GET /api/ai/mention/search/:type`

@提及搜索（schema/flow/widget）。

### `GET /api/ai/sync/schema/:schemaId/flows`

Schema → Flow 反向查询。

### `GET /api/ai/sync/flow/:flowId/node/:nodeId/schema`

Flow → Schema 正向查询。

### `POST /api/ai/sync/schema/:schemaId/update-flows`

Schema 更新时同步 Flow。

### `POST /api/ai/sync/bind`

绑定 Schema 到 Flow 节点。

---

## 37. AI 健康检查

### `GET /api/ai/health`

AI Provider 连通性和 API Key 状态。

---

## 38. AI 监控

### `GET /api/ai/monitor/stats`

Agent 性能统计（聚合）。

### `GET /api/ai/monitor/recent`

最近 Agent 指标。

### `GET /api/ai/monitor/alerts`

性能告警（慢操作/失败/高 token）。

### `GET /api/ai/monitor/summary`

快速概览。

---

## 39. AI 插件市场

### `GET /api/ai/plugins`

插件列表。

### `GET /api/ai/plugins/user/installed`

用户已安装插件。

### `GET /api/ai/plugins/:id`

插件详情。

### `POST /api/ai/plugins`

创建插件。

### `PUT /api/ai/plugins/:id`

更新插件。

### `DELETE /api/ai/plugins/:id`

删除插件。

### `POST /api/ai/plugins/:id/install`

安装插件。

### `POST /api/ai/plugins/:id/uninstall`

卸载插件。

---

## 40. RAG 知识库

### `POST /api/ai/rag/reindex`

批量重建嵌入索引。

### `GET /api/ai/rag/status`

索引状态统计。

### `DELETE /api/ai/rag/:schemaId`

删除 Schema 嵌入。

### `POST /api/ai/rag/reindex/:schemaId`

重建单个 Schema 索引。

---

## 41. LLM Provider

### `GET /api/ai/llm-providers`

Provider 列表及策略。

### `POST /api/ai/llm-provider`

设置默认 Provider/策略。

### `GET /api/ai/llm-usage`

使用量统计。

---

## 42. AI 协作

### `GET /api/ai/collaboration/sessions`

活跃协作会话。

### `GET /api/ai/collaboration/sessions/:id`

会话信息。

### `GET /api/ai/collaboration/conversations/:id/export`

导出对话为 JSON。

---

## 43. 提示词模板

### `GET /api/ai/prompts`

提示词模板列表。

### `POST /api/ai/prompts`

创建模板。

### `GET /api/ai/prompts/:id`

模板详情。

### `PUT /api/ai/prompts/:id`

更新模板。

### `DELETE /api/ai/prompts/:id`

删除模板。

### `POST /api/ai/prompts/:id/analyze`

分析提示词质量。

### `POST /api/ai/prompts/:id/optimize`

基于反馈优化提示词。

### `POST /api/ai/prompts/:id/test`

测试提示词。

### `GET /api/ai/prompts/:id/versions`

版本历史。

### `POST /api/ai/prompts/:id/render`

渲染模板变量。

### `POST /api/ai/prompts/seed`

种子内置模板。

---

## 44. AI 运行时决策

> ⚠️ 以下接口部分为 TODO 占位

### `POST /api/ai/runtime/recommend-assignee`

智能指派人推荐（当前: 规则引擎）。

### `POST /api/ai/runtime/evaluate-condition`

条件表达式评估（当前: 返回固定 true）。

### `POST /api/ai/runtime/predict-outcome`

预测审批结果（当前: 返回默认值）。

### `POST /api/ai/runtime/detect-anomaly`

异常检测（当前: 超时检测）。

### `POST /api/ai/runtime/approval-suggestion`

审批建议（当前: 返回通用建议）。

---

## 附录: ID 格式说明

所有资源的 `_id` 字段均为 MongoDB ObjectId（24 位十六进制字符串），如 `685faa86c32e0839b4f9de6f`。

路由参数中的 ID 校验统一使用 `mongoose.Types.ObjectId.isValid(id)`。

---

## 附录: 中间件说明

| 中间件 | 作用 | 使用方式 |
|---|---|---|
| `auth` | JWT 认证 | `Authorization: Bearer <token>` |
| `apiKeyAuth` | API Key 认证 | `X-API-Key: sk-xxx` |
| `apiOrJwtAuth` | 双通道认证 | 上述两种任选 |
| `permission` | 权限校验 | 需指定权限 code |
| `dataScope` | 数据范围过滤 | 基于角色配置 |
| `tenantContext` | 租户上下文 | 自动注入 tenantId |
| `auditLog` | 审计日志 | 自动记录写操作 |
| `validate` | Zod 校验 | 请求体/查询参数 |
| `timeout` | 超时控制 | 30秒，SSE 跳过 |

## 附录: 通用响应格式

### 成功响应
```json
{
  "code": 200,
  "data": { ... },
  "message": "success"
}
```

### 分页响应
```json
{
  "code": 200,
  "data": {
    "list": [...],
    "total": 100,
    "page": 1,
    "pageSize": 20
  }
}
```

### 错误响应
```json
{
  "code": 400,
  "message": "参数错误",
  "errors": [...]
}
```
