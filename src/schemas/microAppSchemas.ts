import { z } from 'zod'

export const createMicroAppSchema = z.object({
  name: z.string().min(1, '应用名称不能为空').max(50, '应用名称最多50个字符'),
  url: z.string().min(1, '应用URL不能为空').max(500, '应用URL最多500个字符'),
  icon: z.string().max(200).optional(),
  layout: z.enum(['with-menu', 'without-menu']).optional(),
  activeRule: z.string().min(1, '激活规则不能为空').max(200, '激活规则最多200个字符'),
  permissions: z.array(z.string()).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sort: z.number().int().min(0).optional(),
  remark: z.string().max(500).optional(),
}).strict()

export const updateMicroAppSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  url: z.string().min(1).max(500).optional(),
  icon: z.string().max(200).optional(),
  layout: z.enum(['with-menu', 'without-menu']).optional(),
  activeRule: z.string().min(1).max(200).optional(),
  permissions: z.array(z.string()).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sort: z.number().int().min(0).optional(),
  remark: z.string().max(500).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})
