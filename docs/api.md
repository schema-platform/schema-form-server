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

## 认证

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/auth/login` | 登录 | 否 |
| POST | `/auth/register` | 注册 | 否 |
| GET | `/auth/me` | 当前用户信息 | 是 |
| POST | `/auth/logout` | 登出 | 是 |

## Schema 管理

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/schemas` | 列表（支持 search/type/status 分页） | 是 |
| POST | `/schemas` | 创建 | 是 |
| GET | `/schemas/:id` | 详情 | 是 |
| PUT | `/schemas/:id` | 更新 | 是 |
| DELETE | `/schemas/:id` | 删除 | 是 |
| GET | `/schemas/published` | 已发布列表 | 是 |

## 模板

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/templates` | 列表（支持 search/category/tag 分页） | 否 |
| POST | `/templates` | 创建 | 是 |
| GET | `/templates/:id` | 详情 | 否 |
| PUT | `/templates/:id` | 更新 | 是 |
| DELETE | `/templates/:id` | 删除 | 是 |
| POST | `/templates/:id/apply` | 应用模板（返回克隆的 widgets） | 否 |

## 流程

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/flows` | 流程定义列表 | 是 |
| POST | `/flows` | 创建流程定义 | 是 |
| GET | `/flows/:id` | 流程定义详情 | 是 |
| PUT | `/flows/:id` | 更新流程定义 | 是 |
| DELETE | `/flows/:id` | 删除流程定义 | 是 |
| POST | `/flows/:id/versions` | 保存版本 | 是 |
| GET | `/flows/:id/versions` | 版本列表 | 是 |
| POST | `/flows/:id/start` | 启动流程实例 | 是 |
| GET | `/flow-instances` | 实例列表 | 是 |
| GET | `/flow-instances/:id` | 实例详情 | 是 |
| POST | `/flow-instances/:id/complete` | 完成任务 | 是 |
| POST | `/flow-instances/:id/reject` | 驳回 | 是 |

## 系统管理

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/menus` | 菜单列表 | 是 |
| GET | `/users` | 用户列表 | 是 |
| GET | `/roles` | 角色列表 | 是 |
| GET | `/dict/types` | 字典类型列表 | 是 |
| GET | `/dict/data/:typeCode` | 字典数据 | 是 |
| GET | `/micro-apps` | 微应用列表 | 是 |
| GET | `/model-configs` | 模型配置列表 | 是 |

## 健康检查

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/health` | 健康检查（含 DB ping） | 否 |
