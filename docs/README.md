# Server 文档

`@schema-form/server` — Koa.js + MongoDB 后端服务

## 快速开始

```bash
# 启动本地开发（需要 Docker MongoDB）
pnpm db:up
pnpm dev:server

# 种子数据
pnpm db:seed

# 构建
pnpm build:server
```

## 文档目录

- [API 接口](./api.md) — 所有 REST API 端点
- [数据模型](./models.md) — Mongoose 模型定义
- [数据库](./database.md) — MongoDB 连接与配置
