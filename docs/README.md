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

- [能力总览](./capabilities.md) — 已实现功能矩阵、技术栈、架构特点
- [API 接口文档](./api-reference.md) — 全部 190+ 端点详细说明（含请求/响应示例）
- [API 接口](./api.md) — REST API 端点概览
- [数据模型](./models.md) — Mongoose 模型定义
- [数据库](./database.md) — MongoDB 连接与配置
