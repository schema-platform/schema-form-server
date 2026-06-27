import { z } from 'zod'

export const createFlowTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  graph: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
  }),
  thumbnail: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
  isBuiltin: z.boolean().optional(),
})

export const updateFlowTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  graph: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
  }).optional(),
  thumbnail: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
  isBuiltin: z.boolean().optional(),
})

export const applyFlowTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
})
