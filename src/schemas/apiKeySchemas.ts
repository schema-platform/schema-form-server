import { z } from 'zod'

export const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  permissions: z.array(z.string()).default([]),
  expiresAt: z.string().datetime({ message: 'Invalid ISO 8601 datetime' }).nullable().optional(),
}).strict()

export const updateApiKeyStatusSchema = z.object({
  status: z.enum(['active', 'disabled'], { message: 'Status must be active or disabled' }),
}).strict()
