import { z } from 'zod'

const dataScopeEnum = z.enum(['all', 'dept', 'self', 'custom'])

export const createRoleSchema = z.object({
  name: z.string().min(1, '角色名称不能为空').max(50, '角色名称最多50个字符'),
  description: z.string().max(200, '描述最多200个字符').optional(),
  permissions: z.array(z.string()).optional(),
  data_scope: dataScopeEnum.optional(),
  dept_ids: z.array(z.string()).optional(),
}).strict()

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(200).optional(),
  permissions: z.array(z.string()).optional(),
  data_scope: dataScopeEnum.optional(),
  dept_ids: z.array(z.string()).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required.',
})
