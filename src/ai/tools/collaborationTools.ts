/**
 * Collaboration tools — 智能体协作工具
 *
 * 允许智能体请求其他智能体的帮助，实现智能体之间的协作。
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'

// ────────────────────────────────────────────
// 协作请求工具
// ────────────────────────────────────────────

export interface CollaborationRequest {
  targetAgent: 'editor' | 'flow' | 'page'
  description: string
  context?: Record<string, unknown>
}

export const requestCollaborationTool = tool(
  async ({ targetAgent, description, context }): Promise<string> => {
    // 这个工具的实际执行由图结构处理
    // 工具返回协作请求，图结构会检测到并路由到对应的智能体
    return JSON.stringify({
      success: true,
      message: `已请求 ${targetAgent} 专家协作：${description}`,
      collaboration: {
        targetAgent,
        description,
        context,
      },
    })
  },
  {
    name: 'request_collaboration',
    description: `请求其他专家智能体协作。当你发现自己无法独立完成任务，需要其他专家的帮助时使用。

可用的专家：
- editor: 表单/UI 生成专家
- flow: 流程/BPMN 生成专家
- page: 业务页面配置专家

参数：targetAgent — 要请求协作的专家；description — 需要协作的具体任务描述；context — 可选的上下文信息。
返回 JSON 包含 message 和 collaboration 请求对象。`,
    schema: z.object({
      targetAgent: z.enum(['editor', 'flow', 'page']).describe('要请求协作的专家智能体'),
      description: z.string().describe('需要协作的具体任务描述'),
      context: z.record(z.unknown()).optional().describe('传递给协作智能体的上下文信息'),
    }),
  },
)

// ────────────────────────────────────────────
// 导出工具数组
// ────────────────────────────────────────────

export const collaborationTools = [requestCollaborationTool]
