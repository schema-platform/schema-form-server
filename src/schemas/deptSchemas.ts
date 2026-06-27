import { z } from 'zod'

export const createDeptSchema = z.object({
  name: z.string().min(1, '部门名称不能为空').max(100, '部门名称最多100个字符'),
  parentId: z.string().nullable().default(null),
  sort: z.number().int().min(0).default(0),
  status: z.enum(['active', 'inactive']).default('active'),
  leader: z.string().max(50, '负责人最多50个字符').default(''),
}).strict()

export const updateDeptSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  parentId: z.string().nullable().optional(),
  sort: z.number().int().min(0).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  leader: z.string().max(50).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})

export const moveDeptSchema = z.object({
  parentId: z.string().nullable(),
}).strict()
