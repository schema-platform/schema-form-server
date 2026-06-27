import { z } from 'zod'

const modelParametersSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).optional(),
  topP: z.number().min(0).max(1).optional(),
}).strict()

export const createModelConfigSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  provider: z.enum(['deepseek', 'openai', 'anthropic', 'ollama']),
  model: z.string().min(1, 'Model is required').max(100),
  apiKey: z.string().max(500).optional().default(''),
  baseUrl: z.string().url('Invalid base URL').max(500).optional().or(z.literal('')).default(''),
  parameters: modelParametersSchema.optional(),
  isDefault: z.boolean().optional().default(false),
}).strict()

export const updateModelConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.enum(['deepseek', 'openai', 'anthropic', 'ollama']).optional(),
  model: z.string().min(1).max(100).optional(),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().url('Invalid base URL').max(500).optional().or(z.literal('')),
  parameters: modelParametersSchema.optional(),
  isDefault: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required for update.',
})

export const testModelConfigSchema = z.object({
  message: z.string().min(1, 'Test message is required').max(1000).optional().default('Hello, respond with OK'),
}).strict()
