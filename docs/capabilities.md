# schema-form-server 能力总览

> 最后更新: 2026-06-28

## 一、项目定位

`@schema-form/server` 是 Schema Platform 的后端 API 服务，为可视化表单设计器、BPMN 流程引擎、AI 助手提供统一的数据层和业务逻辑层。

## 二、技术栈

| 层面 | 技术 |
|---|---|
| 运行时 | Node.js + TypeScript (ESM) |
| Web 框架 | Koa.js |
| 数据库 | MongoDB 8 (Mongoose ODM) |
| 认证 | JWT + bcryptjs + OAuth2 授权码 |
| AI 引擎 | LangGraph (多 Agent 架构) |
| 实时通信 | Socket.IO |
| 缓存 | Redis (可选) |
| 部署 | 传统 HTTP Server (自建服务器) |

## 三、核心能力矩阵

### 3.1 用户与权限体系

| 能力 | 说明 | 状态 |
|---|---|---|
| 多租户隔离 | AsyncLocalStorage + Mongoose 插件自动注入 tenantId | ✅ |
| RBAC 权限 | 角色-权限映射，中间件校验，Redis 缓存 (5min TTL) | ✅ |
| 数据权限范围 | all / dept / self / custom 四种模式 | ✅ |
| SSO 单点登录 | OAuth2 授权码模式，跨应用会话共享 | ✅ |
| API Key 认证 | 机器对机器调用，支持权限范围和过期时间 | ✅ |
| JWT + API Key 双通道 | apiOrJwtAuth 中间件，灵活切换 | ✅ |
| 审计日志 | 自动记录写操作，含请求体、IP、用户 | ✅ |
| 登录日志 | 记录登录成功/失败，支持清空 | ✅ |
| 在线用户管理 | 基于 SSO 会话，支持强制下线 | ✅ |
| 密码策略 | 可配置的密码强度校验 | ✅ |

### 3.2 组织架构

| 能力 | 说明 | 状态 |
|---|---|---|
| 部门管理 | 树形结构，支持移动（含循环检测） | ✅ |
| 岗位管理 | 岗位 CRUD，支持排序和状态 | ✅ |
| 菜单管理 | 树形菜单，支持前端动态路由生成 | ✅ |
| 用户管理 | CRUD + 批量导入导出 Excel | ✅ |
| 租户管理 | 创建时自动初始化角色/管理员/菜单 | ✅ |

### 3.3 Schema 管理

| 能力 | 说明 | 状态 |
|---|---|---|
| Schema CRUD | 创建、编辑、删除表单 Schema | ✅ |
| 版本管理 | 自动推入版本快照（最多15个），支持查看/删除 | ✅ |
| 发布机制 | 草稿 → 发布，支持指定版本发布 | ✅ |
| Schema 导入 | 深度校验 widget 树 + ID 重生成 | ✅ |
| 组件模板 | 模板 CRUD + 应用（返回重生成 ID 的 widgets） | ✅ |
| Mock 数据生成 | 根据 Schema 自动生成模拟表单数据 | ✅ |

### 3.4 表单数据

| 能力 | 说明 | 状态 |
|---|---|---|
| 表单提交 | 按 Schema 提交数据 | ✅ |
| 提交管理 | 分页查询、状态筛选、单条/批量删除 | ✅ |
| 审批流程 | submitted → approved / rejected 状态流转 | ✅ |
| 数据导出 | CSV / Excel 格式导出 | ✅ |
| 批量操作 | 批量删除、批量更新状态 | ✅ |

### 3.5 流程引擎

| 能力 | 说明 | 状态 |
|---|---|---|
| 流程定义 | CRUD + 发布 + 归档生命周期 | ✅ |
| 流程版本 | 版本化存储，支持多版本并存 | ✅ |
| 流程实例 | 启动、取消、状态查询、流程图获取 | ✅ |
| 任务管理 | 认领、完成、驳回、驳回到指定节点、委派 | ✅ |
| 批量审批 | 批量通过、批量驳回、批量委派 | ✅ |
| 审批日志 | 完整的审批轨迹记录 | ✅ |
| 流程通知 | 任务创建/超时/完成/委派/驳回/流程完成通知 | ✅ |
| 流程模板 | 内置模板 + 自定义模板，支持应用创建流程 | ✅ |
| 流程监控 | 概览、瓶颈分析、趋势分析 | ✅ |
| 中间事件 | 消息事件（发送/接收/完成） | ✅ |
| 定时器 | Timer Intermediate Event，Cron 触发 | ✅ |
| 数据导出 | 审批日志 CSV/Excel 导出 | ✅ |

### 3.6 AI 能力

| 能力 | 说明 | 状态 |
|---|---|---|
| 多 Agent 对话 | LangGraph 驱动，Router → Editor/Flow/Page/General | ✅ |
| SSE 流式输出 | thinking/text/tool_call/schema/flow/diff 事件 | ✅ |
| HITL 中断-恢复 | 操作需确认时暂停，用户确认后继续 | ✅ |
| RAG 语义搜索 | Schema 向量嵌入 + 语义检索 | ✅ |
| 多 LLM Provider | DeepSeek/OpenAI/Claude/Ollama，含路由策略 | ✅ |
| MCP 协议 | SSE 传输的 Schema/Flow/Widget 三个 MCP Server | ✅ |
| 版本管理 | AI 生成内容自动版本化，支持 diff 和回滚 | ✅ |
| 插件市场 | 插件 CRUD + 安装/卸载 | ✅ |
| 提示词管理 | 模板 CRUD + 质量分析 + 反馈优化 + 测试 | ✅ |
| 行业 Agent | 医疗/金融/教育行业专用模板 | ✅ |
| 行为学习 | 用户行为记录 → 偏好分析 → 个性化推荐 | ✅ |
| Schema-Flow 同步 | Schema 更新自动同步引用它的 Flow 节点 | ✅ |
| @提及搜索 | 搜索 schema/flow/widget 并引用 | ✅ |
| 对话导出 | 导出为 JSON 格式 | ✅ |
| AI 监控 | Agent 性能统计、告警、概览 | ✅ |
| 消息反馈 | 正面/负面反馈，支持评论 | ✅ |

### 3.7 集成与扩展

| 能力 | 说明 | 状态 |
|---|---|---|
| Webhook | 事件驱动，HMAC 签名验证，自动启动流程 | ✅ |
| 字典管理 | 字典类型 + 数据项，支持按编码查询 | ✅ |
| 系统参数 | 系统/业务参数，支持按 key 查询 | ✅ |
| 微前端应用 | qiankun 微应用注册与管理 | ✅ |
| 文件上传 | 图片/头像/通用文件，静态文件访问 | ✅ |
| 仪表盘统计 | Schema/Flow/AI/活动聚合统计 | ✅ |
| 事件总线 | schema.published / submission.created / webhook.triggered | ✅ |

### 3.8 基础设施

| 能力 | 说明 | 状态 |
|---|---|---|
| 全局错误处理 | errorHandler 中间件，统一错误响应 | ✅ |
| 请求超时 | 30秒超时，SSE 端点自动跳过 | ✅ |
| 请求校验 | Zod Schema 校验中间件 | ✅ |
| CORS | 可配置的跨域来源 | ✅ |
| Helmet | 安全头 | ✅ |
| 优雅关闭 | SIGTERM/SIGINT 信号处理 | ✅ |
| 优雅关闭 | SIGTERM/SIGINT 信号处理 | ✅ |
| Redis 缓存 | 可选的缓存层，支持 key 模式删除 | ✅ |
| 结构化日志 | 统一日志格式 | ✅ |
| 数据库种子 | 权限/角色/菜单/管理员/微应用/模板/OAuth 客户端 | ✅ |
| 数据库迁移 | src/migrations/ 目录，角色迁移脚本 | ✅ |

## 四、已知 TODO / 未完成功能

| 端点 | 当前状态 | 说明 |
|---|---|---|
| `POST /api/ai/runtime/recommend-assignee` | 规则引擎占位 | 智能指派人推荐待接入 AI |
| `POST /api/ai/runtime/evaluate-condition` | 返回固定 true | 条件表达式评估待实现 |
| `POST /api/ai/runtime/predict-outcome` | 返回默认值 | 审批结果预测待实现 |
| `POST /api/ai/runtime/approval-suggestion` | 返回通用建议 | 审批建议待实现 |
| 在线用户/今日访问统计 | 返回 0 | 活跃度统计待实现 |

## 五、架构特点

1. **分层清晰**: 路由 → 中间件 → 模型，职责分明
2. **多租户原生**: 从中间件到模型层的全链路租户隔离
3. **事件驱动**: EventBus 解耦 Schema 发布、表单提交、Webhook 触发
4. **AI-First**: LangGraph 多 Agent 架构，支持流式输出和人机协作
5. **ObjectId 主键**: 所有模型使用 MongoDB 原生 ObjectId，数据引用一致性好
