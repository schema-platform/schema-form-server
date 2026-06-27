import { z } from 'zod'

export const createTenantSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  code: z.string().min(1, 'Code is required').max(50, 'Code must be 50 characters or fewer')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Code must contain only alphanumeric characters, hyphens, and underscores'),
  status: z.enum(['active', 'inactive', 'suspended']).default('active'),
  config: z.object({
    maxUsers: z.number().int().min(1).max(100000).default(100),
    features: z.array(z.string()).default([]),
  }).default({ maxUsers: 100, features: [] }),
}).strict()

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Code must contain only alphanumeric characters, hyphens, and underscores')
    .optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  config: z.object({
    maxUsers: z.number().int().min(1).max(100000).optional(),
    features: z.array(z.string()).optional(),
  }).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field (name, code, status, or config) is required.',
})
