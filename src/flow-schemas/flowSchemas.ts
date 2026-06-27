import { z } from 'zod'

export const createFlowSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  permissions: z.object({
    editors: z.array(z.string()).optional(),
    launchers: z.array(z.string()).optional(),
    viewers: z.array(z.string()).optional(),
  }).optional(),
})

export const updateFlowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  thumbnail: z.string().optional(),
  permissions: z.object({
    editors: z.array(z.string()).optional(),
    launchers: z.array(z.string()).optional(),
    viewers: z.array(z.string()).optional(),
  }).optional(),
})

export const saveVersionSchema = z.object({
  graph: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
  }),
  metadata: z
    .object({
      viewport: z
        .object({
          x: z.number(),
          y: z.number(),
          zoom: z.number(),
        })
        .optional(),
    })
    .optional(),
})
