# @schema-form/server

后端服务 -- Koa.js API + MongoDB + AI Agent + 流程引擎。

## 项目简介

Schema Form Platform 的后端 API 服务，提供 Schema 存储与发布、用户认证、AI Agent 对话、流程引擎执行、数据管理等核心能力。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Koa.js（ESM 模块） |
| 数据库 | MongoDB + Mongoose 8 |
| 认证 | JWT + bcryptjs |
| AI | LangChain + LangGraph + DeepSeek |
| 流程 | BPMN 引擎（@schema-form/flow-shared） |
| 校验 | Zod |
| 实时通信 | Socket.IO |
| 文件处理 | pdf-parse + mammoth + exceljs |

## 端口配置

| 环境 | 端口 |
|---|---|
| 开发 | 3001 |

## API 路由

### Schema 管理

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/schemas` | 列表（分页+搜索+筛选） |
| `POST` | `/api/schemas` | 创建 |
| `POST` | `/api/schemas/import` | 导入 |
| `GET` | `/api/schemas/:id` | 详情 |
| `PUT` | `/api/schemas/:id` | 更新 |
| `DELETE` | `/api/schemas/:id` | 删除 |
| `POST` | `/api/schemas/:id/publish` | 发布 |
| `GET` | `/api/schemas/published/:sourceId` | 获取已发布版本 |
| `GET` | `/api/schemas/:param/versions` | 版本列表 |
| `GET` | `/api/schemas/:param/versions/:version` | 指定版本 |

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 登出 |
| `GET` | `/api/auth/me` | 当前用户 |

### 字典与选项

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/dict/:code` | 按编码查询字典 |
| `GET` | `/api/options/:category` | 按分类查询选项 |
| `GET` | `/api/options/tree/:category` | 树形选项 |

### 数据

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET/POST` | `/api/data/list` | 数据列表 |
| `GET` | `/api/data/:id` | 数据详情 |

### 系统

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 健康检查（含 DB ping） |
| `GET` | `/api/docs` | API 文档 |
| `GET` | `/api/mock/:schemaId` | 生成 Mock 数据 |

## 数据模型

### FormSchema

核心资源，存储表单 Schema 定义及发布版本。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | String (UUID) | 主键 |
| `name` | String | 名称 |
| `type` | String | `form` / `search_list` |
| `status` | String | `draft` / `published` |
| `json` | Mixed | Schema 树结构 |
| `publishId` | String | 发布版本标识 |
| `createdAt` | Date | 创建时间 |
| `updatedAt` | Date | 更新时间 |

### PublishedSchema

已发布的 Schema 版本快照。

### User

用户账户（JWT 认证）。

## 中间件栈

```
errorHandler -> helmet -> bodyParser -> CORS -> routes
```

## 常用命令

```bash
pnpm dev:server          # 启动开发服务器（热重载）
pnpm build:server        # 编译 TypeScript -> dist/
pnpm db:up               # 启动本地 MongoDB 容器
pnpm db:down             # 停止 MongoDB 容器
pnpm db:seed             # 导入种子数据
```

## 环境变量

| 变量 | 用途 |
|---|---|
| `MONGODB_URI` | MongoDB 连接字符串（必需） |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥（AI 功能必需） |
| `NODE_ENV` | `development` / `production` |
| `PORT` | 服务器端口 |
| `CORS_ORIGINS` | 允许的跨域来源，逗号分隔 |
| `JWT_SECRET` | JWT 签名密钥 |
