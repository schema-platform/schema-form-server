# 生产环境稳定性修复方案

> 问题：每次部署后 AI 对话不稳定，Agents 频繁 400，错误直接暴露给用户。

---

## 一、根因分析（按严重度排序）

### 🔴 P0-1：`source: 'page'` 被 Zod 拦截 → 400

**文件**：`ai/schemas/aiSchemas.ts:13`

```typescript
// 当前代码
source: z.enum(['editor', 'flow', 'standalone']),  // 缺少 'page'

// 图代码 graph.ts:41 接受 'page'
if (state.context.source === 'editor' || state.context.source === 'flow' || state.context.source === 'page')
```

**影响**：前端发送 `source: 'page'` 的请求被 Zod 直接拒绝，返回 400，Page Agent 永远无法到达。

**修复**：
```typescript
source: z.enum(['editor', 'flow', 'page', 'standalone']),
```

---

### 🔴 P0-2：Agent 节点 LLM 调用失败 → 原始错误透传到对话

**文件**：`graph/editorAgent.ts:142-145`、`graph/flowAgent.ts:151-154`、`graph/pageAgent.ts:140-144`

```typescript
// 当前代码 — 直接 re-throw 原始错误
} catch (err) {
  console.error(`[editorAgent] LLM 调用失败:`, err)
  throw err  // DeepSeek API 的 400/401/429 原始错误直接抛出
}
```

**影响**：DeepSeek 返回的原始错误（如 "context_length_exceeded"、"invalid_api_key"、"rate_limit"）直接出现在用户对话中。

**修复**：统一错误包装，返回对用户友好的消息，原始错误只写日志。

---

### 🔴 P0-3：summarizerNode 无 try-catch → 图崩溃

**文件**：`graph/graph.ts:351-398`

```typescript
// 当前代码 — 无任何错误处理
async function summarizerNode(state) {
  const stream = await model.stream([...])  // 如果 LLM 失败，直接崩溃
  for await (const chunk of stream) { ... }
}
```

**影响**：多步任务链完成后，summarizer 调用 LLM 失败会导致整个图执行崩溃，用户看到原始错误。

---

### 🟡 P1-1：ToolNode 无 handleToolErrors → 工具异常中断对话

**文件**：`graph/graph.ts:32`

```typescript
const allToolNode = new ToolNode(allTools)  // 无错误兜底
```

**影响**：MongoDB 连接断开、JSON 解析失败等工具异常会中断整个对话流。

---

### 🟡 P1-2：SSE error 事件格式不一致 → 前端无法统一处理

**文件**：`routes.ts:697-708` vs `routes.ts:830-863`

```typescript
// chat handler — 有 agent 字段
send({ type: 'error', content: `[${phaseLabel}] ${errorMsg}`, agent: currentAgent })

// resume handler — 无 agent 字段
send({ type: 'error', content: errorMsg })

// chat handler 还追加了文本错误
send({ type: 'text', content: `\n\n⚠️ 生成中断：${errorMsg}` })
```

**影响**：前端需要处理 3 种不同的错误格式，错误消息重复显示。

---

### 🟡 P1-3：每次部署后 checkpointer 状态不兼容 → 旧对话 400

**文件**：`graph/checkpointMongo.ts` + `graph/graph.ts:583`

```typescript
// 版本断言桥接
const graph = builder.compile({ checkpointer: checkpointer as unknown as BaseCheckpointSaver })
```

**影响**：如果 `@langchain/langgraph-checkpoint` 版本升级导致序列化格式变化，旧对话的 checkpoint 无法反序列化，恢复对话时崩溃。

---

### 🟢 P2-1：withRetry 未被 Agent 节点使用

**文件**：`graph/agentBase.ts:338-359` 定义了 `withRetry`，但只有 `schemaGenerator.ts` 使用。主 Agent 节点直接调用 `model.stream()` 无重试。

---

## 二、修复方案

### Fix-1：Zod Schema 补全 `source` 枚举（P0）

```typescript
// ai/schemas/aiSchemas.ts
source: z.enum(['editor', 'flow', 'page', 'standalone']),
```

---

### Fix-2：统一 Agent 错误处理层（P0）

新建 `graph/agentErrorHandler.ts`，所有 Agent 节点共用：

```typescript
// graph/agentErrorHandler.ts

import { AIMessage } from '@langchain/core/messages'
import type { AgentStateAnnotation } from './state.js'

/**
 * 用户友好的错误消息映射。
 * 原始错误只写日志，不暴露给用户。
 */
const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  'context_length_exceeded': '对话内容过长，请新建对话或缩短消息',
  'invalid_api_key': 'AI 服务配置异常，请联系管理员',
  'rate_limit': 'AI 服务繁忙，请稍后重试',
  'timeout': 'AI 响应超时，请稍后重试',
  'network': '网络连接异常，请检查网络后重试',
}

function classifyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()

  if (lower.includes('context_length') || lower.includes('too many tokens')) return 'context_length_exceeded'
  if (lower.includes('api_key') || lower.includes('unauthorized') || lower.includes('401')) return 'invalid_api_key'
  if (lower.includes('rate') || lower.includes('429') || lower.includes('too many requests')) return 'rate_limit'
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout'
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('network')) return 'network'

  return 'unknown'
}

/**
 * 包装 Agent 节点的 LLM 调用，统一错误处理。
 *
 * - 原始错误写日志（含完整堆栈）
 * - 返回用户友好的 AIMessage（不中断图执行）
 * - 支持降级消息（如 summarizer 降级为简单列表）
 */
export async function callLLMWithFallback<T>(
  agentName: string,
  fn: () => Promise<T>,
  fallbackContent?: string,
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const errorType = classifyError(err)
    const friendlyMsg = USER_FRIENDLY_MESSAGES[errorType] ?? 'AI 处理异常，请重试'
    const rawMsg = err instanceof Error ? err.message : String(err)

    // 原始错误只写日志
    console.error(`[${agentName}] LLM 调用失败 [${errorType}]:`, rawMsg)

    // 如果有降级内容，返回降级结果（不中断图）
    if (fallbackContent !== undefined) {
      return new AIMessage({ content: fallbackContent }) as unknown as T
    }

    // 否则返回友好的错误消息（不中断图）
    return new AIMessage({
      content: `⚠️ ${friendlyMsg}\n\n> 技术详情已记录到服务端日志，如需帮助请联系管理员。`,
    }) as unknown as T
  }
}
```

**各 Agent 节点改造**：

```typescript
// graph/editorAgent.ts — 改造后
import { callLLMWithFallback } from './agentErrorHandler.js'

export async function editorAgentNode(state) {
  const systemPrompt = await getEditorSystemPrompt()
  const userContent = buildContextMessage(state)
  const model = getLLM({ temperature: 0.7, maxTokens: 8192 })
    .bindTools([...editorTools, ...collaborationTools])

  const truncatedHistory = truncateMessages(state.messages)
  const messages = [new SystemMessage(systemPrompt), ...truncatedHistory, new HumanMessage(userContent)]

  return callLLMWithFallback('editorAgent', async () => {
    const stream = await model.stream(messages)
    let final: AIMessageChunk | null = null
    for await (const chunk of stream) {
      final = final ? final.concat(chunk) : chunk
    }
    if (!final) throw new Error('LLM 返回空流')
    return { messages: [final as unknown as AIMessage] }
  })
}

// graph/graph.ts — summarizerNode 改造后
async function summarizerNode(state) {
  const lastUserMessage = [...state.messages].reverse().find(m => m.constructor.name === 'HumanMessage')
  const userContent = lastUserMessage
    ? (typeof lastUserMessage.content === 'string' ? lastUserMessage.content : JSON.stringify(lastUserMessage.content))
    : '你好'

  const taskResults = state.task.chain
    .filter(step => step.status === 'done')
    .map(step => `✅ ${step.agent} 专家：${step.description}`)
    .join('\n')

  const model = getLLM({ temperature: 0.7, maxTokens: 2048 })
  const prompt = `${SUMMARIZER_SYSTEM_PROMPT}\n\n## 用户需求\n${userContent}\n\n## 执行结果\n${taskResults || '无'}`

  // 降级内容：如果 LLM 失败，直接返回任务列表
  const fallbackContent = `## 执行完成\n\n${taskResults || '无执行结果'}\n\n如需进一步调整，请继续描述需求。`

  const response = await callLLMWithFallback('summarizer', async () => {
    const stream = await model.stream([new SystemMessage(prompt), new HumanMessage(userContent)])
    let content = ''
    for await (const chunk of stream) {
      const c = typeof chunk.content === 'string' ? chunk.content : ''
      if (c) content += c
    }
    return new AIMessage({ content })
  }, fallbackContent)

  return {
    messages: [response instanceof AIMessage ? response : new AIMessage({ content: fallbackContent })],
    session: { ...state.session, currentAgent: 'general' },
  }
}
```

---

### Fix-3：ToolNode 错误兜底（P1）

```typescript
// graph/graph.ts
const allToolNode = new ToolNode(allTools)

// 包装 ToolNode 的错误处理
const allToolNodeWithFallback = {
  async invoke(state: typeof AgentStateAnnotation.State) {
    try {
      return await allToolNode.invoke(state)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ToolNode] 工具执行异常:`, message)
      // 返回一个友好的 ToolMessage，不中断图
      const { ToolMessage } = await import('@langchain/core/messages')
      return {
        messages: [new ToolMessage({
          content: JSON.stringify({ success: false, error: '工具执行异常，请重试', recoverable: true }),
          tool_call_id: 'error',
          name: 'system_error',
        })],
      }
    }
  },
}
```

---

### Fix-4：SSE 错误事件标准化（P1）

```typescript
// routes.ts — 统一错误发送函数
function sendError(send: (data: Record<string, unknown>) => void, opts: {
  error: unknown
  agent?: string
  phase?: 'thinking' | 'generating'
}) {
  const rawMsg = opts.error instanceof Error ? opts.error.message : String(opts.error)
  const errorType = classifyError(opts.error)
  const friendlyMsg = USER_FRIENDLY_MESSAGES[errorType] ?? 'AI 处理异常，请重试'

  // 日志：完整错误
  console.error(`[AI Chat] ${opts.agent ?? 'unknown'} [${opts.phase ?? 'unknown'}]:`, rawMsg)

  // 前端：友好消息
  send({
    type: 'error',
    content: friendlyMsg,           // 用户友好的消息
    agent: opts.agent ?? 'unknown',
    errorType,                      // 分类标识（前端可用于展示不同样式）
    recoverable: errorType !== 'invalid_api_key',  // 是否可重试
  })

  // 不再追加 type: 'text' 的错误消息（避免重复显示）
}

// catch 块改造
} catch (err) {
  if (isGraphInterrupt(err)) {
    // ... interrupt 处理不变
    return
  }

  sendError(send, {
    error: err,
    agent: currentAgent,
    phase: accumulatedContent ? 'generating' : 'thinking',
  })
}
```

---

### Fix-5：Checkpointer 启动校验（P1）

```typescript
// graph/checkpointer.ts
function createCheckpointer(): BaseCheckpointSaver {
  if (process.env.NODE_ENV === 'production') {
    // 生产环境：必须用 MongoDB，失败则抛错阻止启动
    const cp = new MongoDBCheckpointer()
    console.log('[checkpointer] MongoDB checkpointer 初始化成功')
    return cp
  }

  // 开发环境：优先 MongoDB，降级 MemorySaver
  try {
    const cp = new MongoDBCheckpointer()
    console.log('[checkpointer] MongoDB checkpointer 初始化成功')
    return cp
  } catch (err) {
    console.warn('[checkpointer] MongoDB 不可用，降级到 MemorySaver:', err)
    return new MemorySaver() as unknown as BaseCheckpointSaver
  }
}
```

---

### Fix-6：Agent 节点 LLM 重试（P2）

```typescript
// graph/agentBase.ts — 新增带重试的流式调用
export async function streamWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === maxRetries) break

      const status = (err as { status?: number }).status
      // 400 不重试（参数错误），429/5xx 重试
      if (status && status < 500 && status !== 429) break

      const delay = 1000 * Math.pow(2, attempt)
      console.warn(`[streamWithRetry] 重试 ${attempt + 1}/${maxRetries}，等待 ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}
```

---

## 三、错误处理分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Zod 校验（路由入口）                                    │
│  ├── 400: 参数格式错误                                           │
│  └── 修复：补全 source 枚举                                      │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Agent 错误处理（agentErrorHandler.ts）                  │
│  ├── LLM 400/401/429/5xx → 分类 → 用户友好消息                   │
│  ├── 原始错误 → console.error（服务端日志）                       │
│  └── 降级：summarizer 返回任务列表，其他返回友好提示               │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: ToolNode 兜底（graph.ts）                               │
│  ├── 工具异常 → ToolMessage 包装 → LLM 自行处理                   │
│  └── 不中断图执行                                                │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4: SSE 标准化（routes.ts）                                 │
│  ├── 统一 sendError() 函数                                       │
│  ├── 只发送 { type: 'error', content: 友好消息, errorType }       │
│  └── 不再追加 type: 'text' 错误消息                              │
├─────────────────────────────────────────────────────────────────┤
│  Layer 5: 前端展示（ai-app）                                     │
│  ├── 接收 error 事件 → 展示友好消息 + 重试按钮                    │
│  ├── 接收 tool_error 事件 → 展示工具名 + 简要说明                 │
│  └── 不展示技术详情                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、前端错误展示规范

### SSE 事件类型

```typescript
// 标准错误事件
{
  type: 'error',
  content: 'AI 服务繁忙，请稍后重试',    // 用户友好消息
  agent: 'editor',                       // 出错的 Agent
  errorType: 'rate_limit',              // 分类标识
  recoverable: true,                    // 是否可重试
}

// 工具错误事件（不中断对话，LLM 自行处理）
{
  type: 'tool_error',
  toolName: 'search_schemas',
  content: '搜索失败，请重试',
}
```

### 前端处理逻辑

```typescript
// ai-app/stores/ai.ts
case 'error':
  // 不再作为普通消息添加到对话
  // 而是展示为系统提示（可关闭、可重试）
  showErrorToast({
    message: event.content,
    recoverable: event.recoverable,
    onRetry: event.recoverable ? () => resendLastMessage() : undefined,
  })
  break

case 'tool_error':
  // 工具错误：展示为轻量提示，不中断对话
  showToolErrorNotice({
    toolName: event.toolName,
    message: event.content,
  })
  break
```

---

## 五、部署后不稳定的排查清单

| # | 检查项 | 命令/方法 | 预期结果 |
|---|--------|----------|---------|
| 1 | DEEPSEEK_API_KEY 是否设置 | `echo $DEEPSEEK_API_KEY` | 非空，长度 > 10 |
| 2 | MongoDB 连接是否正常 | `curl http://localhost:3001/api/health` | `db.ping: ok` |
| 3 | Checkpointer 初始化日志 | 搜索 `checkpointer` 日志 | `MongoDB checkpointer 初始化成功` |
| 4 | 模型名是否正确 | 搜索 `getLLM` 调用 | `deepseek-v4-pro` |
| 5 | source='page' 是否通过校验 | 发送 `source: 'page'` 请求 | 不返回 400 |
| 6 | Agent 节点错误日志 | 搜索 `[xxxAgent] LLM 调用失败` | 应该有友好错误分类 |
| 7 | SSE error 事件格式 | 前端 Network 面板 | 只有 `type: 'error'`，无重复 `type: 'text'` |

---

## 六、实施顺序

| 优先级 | Fix | 工作量 | 影响范围 |
|--------|-----|--------|---------|
| P0 | Fix-1: source 枚举补全 | 1 行 | Page Agent 可用 |
| P0 | Fix-2: Agent 错误处理层 | 新文件 + 3 个 Agent 改造 | 所有 Agent 不再暴露原始错误 |
| P0 | Fix-3: summarizerNode try-catch | 1 处 | 多步任务不再崩溃 |
| P1 | Fix-4: SSE 错误标准化 | routes.ts 改造 | 前端统一处理 |
| P1 | Fix-5: Checkpointer 启动校验 | 1 处 | 生产环境快速失败 |
| P2 | Fix-6: Agent LLM 重试 | agentBase.ts | 瞬态错误自动恢复 |

**预计总工作量**：1-2 天
