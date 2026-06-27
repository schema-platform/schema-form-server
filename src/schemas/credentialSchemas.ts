import { z } from 'zod'

export const createCredentialSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  type: z.enum(['api_key', 'basic_auth', 'bearer_token']),
  data: z.record(z.string(), z.string()),
}).strict()

export const updateCredentialSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['api_key', 'basic_auth', 'bearer_token']).optional(),
  data: z.record(z.string(), z.string()).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field (name, type, or data) is required.',
})
