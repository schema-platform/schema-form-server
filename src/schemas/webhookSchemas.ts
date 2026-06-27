import { z } from 'zod'

const SUPPORTED_EVENTS = ['schema.published', 'submission.created', 'flow.completed', 'flow.rejected'] as const

export const createWebhookSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  url: z.string().url('Invalid URL format'),
  events: z.array(z.enum(SUPPORTED_EVENTS)).min(1, 'At least one event is required'),
  secret: z.string().min(1, 'secret is required').max(256),
  status: z.enum(['active', 'inactive']).optional().default('active'),
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).max(10).optional().default(3),
    backoffMs: z.number().int().min(100).max(60000).optional().default(1000),
  }).optional().default({}),
  flowDefinitionId: z.string().uuid().optional().nullable(),
  method: z.enum(['GET', 'POST']).optional().default('POST'),
  bodyMapping: z.record(z.string(), z.string()).optional().default({}),
}).strict()

export const updateWebhookSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.string().url('Invalid URL format').optional(),
  events: z.array(z.enum(SUPPORTED_EVENTS)).min(1).optional(),
  secret: z.string().min(1).max(256).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).max(10).optional(),
    backoffMs: z.number().int().min(100).max(60000).optional(),
  }).optional(),
  flowDefinitionId: z.string().uuid().nullable().optional(),
  method: z.enum(['GET', 'POST']).optional(),
  bodyMapping: z.record(z.string(), z.string()).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})
