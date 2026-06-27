import { z } from 'zod'

// ────────────────────────────────────────────
// POST /api/ai/chat request schema
// ────────────────────────────────────────────
export const chatRequestSchema = z.object({
  conversationId: z.string().uuid('Invalid conversationId format').optional(),
  message: z
    .string()
    .min(1, 'Message is required')
    .max(10000, 'Message must be 10000 characters or fewer'),
  context: z.object({
    source: z.enum(['editor', 'flow', 'page', 'standalone']),
    schemaId: z.string().optional(),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    version: z.string().optional(),
    preferences: z.record(z.string(), z.unknown()).optional(),
    historySummary: z.string().optional(),
    /** 当前已生成的 Schema（多轮迭代时前端携带） */
    currentSchema: z.array(z.record(z.string(), z.unknown())).optional(),
    /** 当前已生成的流程（多轮迭代时前端携带） */
    currentFlow: z.record(z.string(), z.unknown()).optional(),
    /** 当前选中的组件信息 */
    selectedWidget: z.object({
      id: z.string(),
      type: z.string(),
      field: z.string().optional(),
      label: z.string().optional(),
    }).optional(),
    /** 编辑器当前模式 */
    editorMode: z.enum(['edit', 'preview']).optional(),
  }),
  mentions: z.array(z.object({
    id: z.string().min(1),
    type: z.enum(['schema', 'flow']),
    name: z.string().min(1),
  })).optional(),
}).strict()

export type ChatRequest = z.infer<typeof chatRequestSchema>

// ────────────────────────────────────────────
// POST /api/ai/publish request schema
// ────────────────────────────────────────────
export const publishRequestSchema = z.object({
  conversationId: z.string().uuid('Invalid conversationId format'),
  type: z.enum(['schema', 'flow']),
  payload: z.union([
    z.array(z.record(z.string(), z.unknown())),   // Widget[]
    z.record(z.string(), z.unknown()),            // FlowGraph
  ]),
  target: z.object({
    type: z.enum(['flow_node']),
    flowId: z.string().min(1),
    nodeId: z.string().min(1),
  }).optional(),
}).strict()

export type PublishRequest = z.infer<typeof publishRequestSchema>

// ────────────────────────────────────────────
// Prompt Template schemas
// ────────────────────────────────────────────

export const promptTemplateCreateSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  description: z.string().max(1000).optional().default(''),
  category: z.enum(['schema', 'flow', 'general', 'custom']).optional().default('custom'),
  template: z.string().min(1, 'template is required').max(50000),
  variables: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
}).strict()

export type PromptTemplateCreateRequest = z.infer<typeof promptTemplateCreateSchema>

export const promptTemplateUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.enum(['schema', 'flow', 'general', 'custom']).optional(),
  template: z.string().min(1).max(50000).optional(),
  variables: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
}).strict()

export type PromptTemplateUpdateRequest = z.infer<typeof promptTemplateUpdateSchema>

export const promptOptimizeSchema = z.object({
  feedback: z.array(z.object({
    rating: z.union([z.literal(1), z.literal(-1)]),
    comment: z.string().max(1000).optional(),
  })).min(1, 'At least one feedback entry is required').max(100),
}).strict()

export type PromptOptimizeRequest = z.infer<typeof promptOptimizeSchema>

export const promptTestSchema = z.object({
  testCases: z.array(z.object({
    input: z.string().min(1, 'input is required'),
    expected: z.string().optional(),
  })).min(1, 'At least one test case is required').max(20),
}).strict()

export type PromptTestRequest = z.infer<typeof promptTestSchema>

// ────────────────────────────────────────────
// POST /api/ai/behavior request schema
// ────────────────────────────────────────────
export const behaviorRequestSchema = z.object({
  action: z.enum(['use_component', 'set_property', 'create_schema', 'generate_ai']),
  target: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).strict()

export type BehaviorRequest = z.infer<typeof behaviorRequestSchema>

// ────────────────────────────────────────────
// Plugin marketplace schemas
// ────────────────────────────────────────────

export const pluginCreateSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  description: z.string().max(2000).optional().default(''),
  author: z.string().max(100).optional(),
  version: z.string().max(50).optional().default('1.0.0'),
  category: z.enum(['productivity', 'development', 'business', 'other']).optional().default('other'),
  icon: z.string().max(500).optional().default(''),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()).optional(),
  })).optional().default([]),
  prompt: z.string().max(50000).optional().default(''),
}).strict()

export type PluginCreateRequest = z.infer<typeof pluginCreateSchema>

export const pluginUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  version: z.string().max(50).optional(),
  category: z.enum(['productivity', 'development', 'business', 'other']).optional(),
  icon: z.string().max(500).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  prompt: z.string().max(50000).optional(),
  enabled: z.boolean().optional(),
}).strict()

export type PluginUpdateRequest = z.infer<typeof pluginUpdateSchema>

export const pluginInstallSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
}).strict()

export type PluginInstallRequest = z.infer<typeof pluginInstallSchema>
