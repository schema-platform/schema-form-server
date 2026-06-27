import { z } from 'zod'

export const createSchemaSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  type: z.enum(['form', 'search-list', 'search_list']).default('form'),
  json: z.array(z.unknown()),
  editId: z.string().uuid('Invalid UUID format').optional(),
  thumbnail: z.string().optional(),
}).strict()

export const updateSchemaSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  json: z.union([z.array(z.unknown()), z.record(z.unknown())]).optional(),
  type: z.enum(['form', 'search_list']).optional(),
  status: z.enum(['draft']).optional(),
  thumbnail: z.string().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field (name, json, type, or status) is required.',
})

export const importSchemaSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  type: z.enum(['form', 'search-list', 'search_list']).default('form'),
  json: z.array(z.unknown()),
  thumbnail: z.string().optional(),
}).strict()
