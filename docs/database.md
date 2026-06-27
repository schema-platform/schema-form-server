# 数据库配置

## 连接

MongoDB 8，通过 Mongoose ODM 连接。

连接字符串由环境变量 `MONGODB_URI` 控制：

| 环境 | 连接地址 |
|------|----------|
| 本地开发 | `mongodb://user:pass@localhost:27017/schema-form?authSource=admin` |
| 本地 Docker | `mongodb://user:pass@localhost:27017/formgrid` |
| 生产 | `mongodb://127.0.0.1:27017/schema-form` |

**注意**：请在 `.env` 文件中配置实际的连接字符串，不要硬编码在代码中。

## Docker 本地开发

```bash
pnpm db:up      # 启动 MongoDB 8 容器
pnpm db:down    # 停止
pnpm db:seed    # 种子数据（用户/角色/权限/菜单/模板/示例表单）
```

Docker Compose 配置：`deploy/docker-compose.yml`

## 种子数据

`pnpm db:seed` 执行 `packages/server/seed.ts`：

1. 创建权限（50+ 权限码）
2. 创建角色（admin/flow_designer/flow_approver）
3. 创建用户（admin/zhangsan/lisi/wangwu/zhaoliu）
4. 创建 SSO 客户端
5. 创建模型配置（DeepSeek/GPT/Claude）
6. 创建内置模板（7 个：4 表单 + 3 表格）
7. 创建示例表单

内置模板每次启动时**强制更新**（删除旧数据后重新插入）。

## 多租户

通过 `tenantPlugin` Mongoose 插件实现，自动为查询添加 `tenantId` 过滤。
