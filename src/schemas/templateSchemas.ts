import { z } from 'zod'

const CATEGORIES = ['form', 'layout', 'table', 'search', 'chart', 'business', 'report', 'other'] as const

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  description: z.string().max(500).optional().default(''),
  category: z.enum(CATEGORIES).optional().default('other'),
  widgetType: z.string().optional().default(''),
  thumbnail: z.string().optional().default(''),
  widgets: z.array(z.record(z.unknown())).min(1, 'At least one widget is required'),
  tags: z.array(z.string()).optional().default([]),
  isBuiltin: z.boolean().optional().default(false),
}).strict()

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  category: z.enum(CATEGORIES).optional(),
  widgetType: z.string().optional(),
  thumbnail: z.string().optional(),
  widgets: z.array(z.record(z.unknown())).min(1).optional(),
  tags: z.array(z.string()).optional(),
  isBuiltin: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})
