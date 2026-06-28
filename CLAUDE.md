# schema-form-server

`@schema-form/server` — 可视化设计器后端 API 服务。

## 项目规则

### 技术栈
- Koa.js + TypeScript（ESM 模块）
- MongoDB 8（Mongoose ODM）
- JWT + bcryptjs 认证

### 架构规则
- **路由聚合**：所有 API 路由在 `src/` 下按模块组织（schema、auth、data、dict、options、mock、docs、health、flow）
- **中间件栈**：errorHandler → helmet → bodyParser → CORS → routes
- **数据模型**：所有模型使用 MongoDB 原生 ObjectId 作为主键，`json` 字段为 Mixed 类型存储 schema 树

### 分层规范
1. 路由 → `src/` 下各模块目录
2. 中间件 → `src/middleware/`
3. 数据模型 → `src/models/`
4. 数据库迁移 → `src/migrations/`
5. 流程相关 → `src/flow-*` 目录

### 环境规则
- **gh CLI 已认证**：`gh` 已登录、`GITHUB_TOKEN` 环境变量已就绪，禁止检查 token、禁止询问用户设置

### 代码质量规则
- **禁止跳过问题**：遇到任何报错、警告、异常，必须找到根因并修复，不能以"预存问题""之前就有""不影响运行"为由跳过。每个问题都要记录原因和修复方式

## 迭代规则

- **禁止回滚 git**，渐进式推进
- 数据库 schema 变更必须提供迁移脚本（`src/migrations/`）
- 新增 API 需同步更新文档（`src/docs/`）
- 环境变量变更需同步更新 `.env.example`

## 环境变量

| 变量 | 用途 | 默认值 |
|---|---|---|
| `MONGODB_URI` | MongoDB 连接字符串 | `mongodb://localhost:27017/schema-form` |
| `NODE_ENV` | `development` / `production` | `development` |
| `PORT` | 服务器端口 | 3001（本地）/ 30001（线上） |
| `CORS_ORIGINS` | 允许的跨域来源 | — |

## 常用命令

```bash
pnpm dev          # tsx watch 热重载（端口 3001）
pnpm build        # tsc 编译
pnpm start        # node dist/index.js
pnpm test         # vitest run
pnpm db:up        # 启动 MongoDB Docker 容器
pnpm db:seed      # 种子数据
```
